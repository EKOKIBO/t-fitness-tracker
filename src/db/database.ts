import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  BodyMeasurement,
  Client,
  ClientExerciseNote,
  ClientProgramEnrollment,
  Exercise,
  Program,
  Routine,
  RoutineFolder,
  Workout,
} from '../types/models';
import { DEFAULT_PLATE_INVENTORY_KG } from '../engine/formulas';
import { buildSeedExercises } from '../engine/exercisesSeed';
import { buildSeedData } from '../engine/programsSeed';
import {
  buildBackupSnapshot,
  type TFitBackupSnapshot,
} from '../engine/portability';

export interface SyncMetaRecord {
  key: string;
  value: unknown;
}

class TFitnessDB extends Dexie {
  clients!: EntityTable<Client, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  clientExerciseNotes!: EntityTable<ClientExerciseNote, 'id'>;
  routineFolders!: EntityTable<RoutineFolder, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  programs!: EntityTable<Program, 'id'>;
  clientProgramEnrollments!: EntityTable<ClientProgramEnrollment, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  measurements!: EntityTable<BodyMeasurement, 'id'>;
  syncMeta!: EntityTable<SyncMetaRecord, 'key'>;

  constructor() {
    super('TFitnessOS_v1');
    this.version(1).stores({
      clients: 'id, name, updatedAt, deletedAt',
      exercises: 'id, name, equipment, movementPattern, updatedAt, deletedAt',
      clientExerciseNotes: 'id, clientId, exerciseId, updatedAt, deletedAt',
      routineFolders: 'id, order, updatedAt, deletedAt',
      routines: 'id, folderId, assignedClientId, updatedAt, deletedAt',
      programs: 'id, isMasterTemplate, updatedAt, deletedAt',
      clientProgramEnrollments: 'id, clientId, programId, active, updatedAt, deletedAt',
      workouts: 'id, clientId, status, startedAt, finishedAt, updatedAt, deletedAt',
      measurements: 'id, clientId, date, updatedAt, deletedAt',
      syncMeta: 'key',
    });
  }
}

export const db = new TFitnessDB();

export const DEFAULT_SETTINGS: AppSettings = {
  activeClientId: 'client-marcus',
  activeWorkoutIds: [],
  quietMode: true,
  barbellWeightKg: 20,
  plateInventoryKg: DEFAULT_PLATE_INVENTORY_KG,
  cloudSyncEnabled: false,
  cloudSyncUrl: '/api/sync',
  cloudSyncKey: '',
  lastSyncAt: 0,
  lastBackupExportAt: 0,
  workoutsSinceLastBackup: 0,
};

export async function getSettings(): Promise<AppSettings> {
  const row = await db.syncMeta.get('appSettings');
  if (!row || !row.value || typeof row.value !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<AppSettings>) };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await db.syncMeta.put({ key: 'appSettings', value: merged });
  return merged;
}

let bootstrapPromise: Promise<void> | null = null;

export function ensureDatabaseBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const initialized = await db.syncMeta.get('seeded_v1');
      if (initialized) return;

      const exercises = buildSeedExercises();
      const seed = buildSeedData();

      await db.transaction(
        'rw',
        [
          db.clients,
          db.exercises,
          db.clientExerciseNotes,
          db.routineFolders,
          db.routines,
          db.programs,
          db.clientProgramEnrollments,
          db.workouts,
          db.measurements,
          db.syncMeta,
        ],
        async () => {
          await db.exercises.bulkPut(exercises);
          await db.clients.bulkPut(seed.clients);
          await db.routineFolders.bulkPut(seed.folders);
          await db.routines.bulkPut(seed.routines);
          await db.programs.bulkPut(seed.programs);
          await db.clientProgramEnrollments.bulkPut(seed.enrollments);
          await db.clientExerciseNotes.bulkPut(seed.notes);
          await db.workouts.bulkPut(seed.workouts);
          await db.measurements.bulkPut(seed.measurements);
          await db.syncMeta.put({ key: 'appSettings', value: DEFAULT_SETTINGS });
          await db.syncMeta.put({ key: 'seeded_v1', value: true });
        }
      );
    })();
  }
  return bootstrapPromise;
}

export async function clearDemoClientsKeepPersonal(): Promise<void> {
  const now = Date.now();
  const demoIds = ['client-marcus', 'client-elena', 'client-lukas'];
  await db.transaction(
    'rw',
    [db.clients, db.workouts, db.measurements, db.clientExerciseNotes, db.clientProgramEnrollments],
    async () => {
      for (const cid of demoIds) {
        const c = await db.clients.get(cid);
        if (c) await db.clients.put({ ...c, deletedAt: now, updatedAt: now });
      }
      const wks = await db.workouts.where('clientId').anyOf(demoIds).toArray();
      await db.workouts.bulkPut(wks.map((w) => ({ ...w, deletedAt: now, updatedAt: now })));
      const meas = await db.measurements.where('clientId').anyOf(demoIds).toArray();
      await db.measurements.bulkPut(meas.map((m) => ({ ...m, deletedAt: now, updatedAt: now })));
      const notes = await db.clientExerciseNotes.where('clientId').anyOf(demoIds).toArray();
      await db.clientExerciseNotes.bulkPut(notes.map((n) => ({ ...n, deletedAt: now, updatedAt: now })));
      const enrs = await db.clientProgramEnrollments.where('clientId').anyOf(demoIds).toArray();
      await db.clientProgramEnrollments.bulkPut(
        enrs.map((e) => ({ ...e, active: false, deletedAt: now, updatedAt: now }))
      );
    }
  );
  await updateSettings({ activeClientId: 'client-personal', activeWorkoutIds: [] });
}

export async function createFullBackupSnapshot(): Promise<TFitBackupSnapshot> {
  const [
    clients,
    exercises,
    clientExerciseNotes,
    routineFolders,
    routines,
    programs,
    clientProgramEnrollments,
    workouts,
    measurements,
  ] = await Promise.all([
    db.clients.toArray(),
    db.exercises.toArray(),
    db.clientExerciseNotes.toArray(),
    db.routineFolders.toArray(),
    db.routines.toArray(),
    db.programs.toArray(),
    db.clientProgramEnrollments.toArray(),
    db.workouts.toArray(),
    db.measurements.toArray(),
  ]);

  return buildBackupSnapshot({
    clients,
    exercises,
    clientExerciseNotes,
    routineFolders,
    routines,
    programs,
    clientProgramEnrollments,
    workouts,
    measurements,
  });
}

async function mergeByUpdatedAt<T extends { id: string; updatedAt: number }>(
  table: {
    get(key: string): PromiseLike<NoInfer<T> | undefined>;
    put(item: NoInfer<T>): PromiseLike<unknown>;
  },
  incoming: T[]
): Promise<number> {
  let applied = 0;
  for (const item of incoming) {
    const existing = await table.get(item.id);
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      await table.put(item);
      applied++;
    }
  }
  return applied;
}

export async function restoreFromBackupSnapshot(
  snapshot: TFitBackupSnapshot,
  mode: 'merge' | 'replace'
): Promise<{ appliedCount: number }> {
  let appliedCount = 0;

  await db.transaction(
    'rw',
    [
      db.clients,
      db.exercises,
      db.clientExerciseNotes,
      db.routineFolders,
      db.routines,
      db.programs,
      db.clientProgramEnrollments,
      db.workouts,
      db.measurements,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.clients.clear(),
          db.exercises.clear(),
          db.clientExerciseNotes.clear(),
          db.routineFolders.clear(),
          db.routines.clear(),
          db.programs.clear(),
          db.clientProgramEnrollments.clear(),
          db.workouts.clear(),
          db.measurements.clear(),
        ]);
        await db.clients.bulkPut(snapshot.data.clients);
        await db.exercises.bulkPut(
          snapshot.data.exercises.length > 0 ? snapshot.data.exercises : buildSeedExercises()
        );
        await db.clientExerciseNotes.bulkPut(snapshot.data.clientExerciseNotes);
        await db.routineFolders.bulkPut(snapshot.data.routineFolders);
        await db.routines.bulkPut(snapshot.data.routines);
        await db.programs.bulkPut(snapshot.data.programs);
        await db.clientProgramEnrollments.bulkPut(snapshot.data.clientProgramEnrollments);
        await db.workouts.bulkPut(snapshot.data.workouts);
        await db.measurements.bulkPut(snapshot.data.measurements);
        appliedCount =
          snapshot.data.clients.length +
          snapshot.data.workouts.length +
          snapshot.data.routines.length +
          snapshot.data.programs.length +
          snapshot.data.measurements.length;
      } else {
        appliedCount += await mergeByUpdatedAt(db.clients, snapshot.data.clients);
        appliedCount += await mergeByUpdatedAt(db.exercises, snapshot.data.exercises);
        appliedCount += await mergeByUpdatedAt(
          db.clientExerciseNotes,
          snapshot.data.clientExerciseNotes
        );
        appliedCount += await mergeByUpdatedAt(db.routineFolders, snapshot.data.routineFolders);
        appliedCount += await mergeByUpdatedAt(db.routines, snapshot.data.routines);
        appliedCount += await mergeByUpdatedAt(db.programs, snapshot.data.programs);
        appliedCount += await mergeByUpdatedAt(
          db.clientProgramEnrollments,
          snapshot.data.clientProgramEnrollments
        );
        appliedCount += await mergeByUpdatedAt(db.workouts, snapshot.data.workouts);
        appliedCount += await mergeByUpdatedAt(db.measurements, snapshot.data.measurements);
      }
    }
  );

  // Ensure activeClientId still points to a valid non-deleted client
  const settings = await getSettings();
  const active = await db.clients.get(settings.activeClientId);
  if (!active || active.deletedAt) {
    const firstValid = await db.clients.filter((c) => !c.deletedAt).first();
    if (firstValid) {
      await updateSettings({ activeClientId: firstValid.id, activeWorkoutIds: [] });
    }
  }

  return { appliedCount };
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
