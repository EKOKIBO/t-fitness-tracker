import type {
  BodyMeasurement,
  Client,
  ClientExerciseNote,
  ClientProgramEnrollment,
  Exercise,
  Program,
  Routine,
  RoutineFolder,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../types/models';
import { calculateHybridE1RM, getRpeStimulusFactor } from './formulas';

export interface TFitBackupSnapshot {
  app: 'T!';
  schemaVersion: 1;
  exportedAt: number;
  exportedDateIso: string;
  stats: {
    clients: number;
    workouts: number;
    routines: number;
    programs: number;
    measurements: number;
  };
  data: {
    clients: Client[];
    exercises: Exercise[];
    clientExerciseNotes: ClientExerciseNote[];
    routineFolders: RoutineFolder[];
    routines: Routine[];
    programs: Program[];
    clientProgramEnrollments: ClientProgramEnrollment[];
    workouts: Workout[];
    measurements: BodyMeasurement[];
  };
}

export function buildBackupSnapshot(data: TFitBackupSnapshot['data']): TFitBackupSnapshot {
  const now = Date.now();
  return {
    app: 'T!',
    schemaVersion: 1,
    exportedAt: now,
    exportedDateIso: new Date(now).toISOString(),
    stats: {
      clients: data.clients.filter((c) => !c.deletedAt).length,
      workouts: data.workouts.filter((w) => !w.deletedAt).length,
      routines: data.routines.filter((r) => !r.deletedAt).length,
      programs: data.programs.filter((p) => !p.deletedAt).length,
      measurements: data.measurements.filter((m) => !m.deletedAt).length,
    },
    data,
  };
}

export function validateBackupSnapshot(raw: unknown): TFitBackupSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup file is not a valid JSON object.');
  }
  const obj = raw as Partial<TFitBackupSnapshot>;
  if (obj.app !== 'T!' || !obj.data || !Array.isArray(obj.data.clients)) {
    throw new Error('This file is not a recognized T! Sync Backup (.tfit.json).');
  }
  return {
    app: 'T!',
    schemaVersion: 1,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
    exportedDateIso: obj.exportedDateIso ?? new Date().toISOString(),
    stats: obj.stats ?? {
      clients: obj.data.clients.length,
      workouts: obj.data.workouts?.length ?? 0,
      routines: obj.data.routines?.length ?? 0,
      programs: obj.data.programs?.length ?? 0,
      measurements: obj.data.measurements?.length ?? 0,
    },
    data: {
      clients: obj.data.clients ?? [],
      exercises: obj.data.exercises ?? [],
      clientExerciseNotes: obj.data.clientExerciseNotes ?? [],
      routineFolders: obj.data.routineFolders ?? [],
      routines: obj.data.routines ?? [],
      programs: obj.data.programs ?? [],
      clientProgramEnrollments: obj.data.clientProgramEnrollments ?? [],
      workouts: obj.data.workouts ?? [],
      measurements: obj.data.measurements ?? [],
    },
  };
}

export async function downloadOrShareFile(
  blob: Blob,
  filename: string,
  shareTitle: string,
  preferNativeShare = false
): Promise<'shared' | 'downloaded'> {
  if (preferNativeShare && typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: shareTitle,
          files: [file],
        });
        return 'shared';
      }
    } catch (err) {
      // If user dismissed iOS share sheet, don't force an extra download
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'shared';
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export async function exportSyncBackupFile(
  snapshot: TFitBackupSnapshot,
  preferShare = false
): Promise<'shared' | 'downloaded'> {
  const dateStamp = new Date(snapshot.exportedAt).toISOString().slice(0, 10);
  const filename = `T-sync-backup-${dateStamp}.tfit.json`;
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  return downloadOrShareFile(blob, filename, `T! Daily Sync Backup (${dateStamp})`, preferShare);
}

/**
 * Lossless CSV Export (Strong / Hevy compatible tabular format)
 */
function csvEscape(val: string | number | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportWorkoutsToCsv(
  workouts: Workout[],
  clientsMap: Map<string, Client>,
  exercisesMap: Map<string, Exercise>
): string {
  const header = [
    'Date',
    'Client Name',
    'Workout Name',
    'Exercise Name',
    'Set Order',
    'Set Type',
    'Weight (kg)',
    'Reps',
    'RPE',
    'e1RM (kg)',
    'Notes',
  ];

  const rows: string[] = [header.join(',')];

  for (const w of workouts) {
    if (w.deletedAt || w.status !== 'completed') continue;
    const clientName = clientsMap.get(w.clientId)?.name ?? w.clientId;
    const dateStr = new Date(w.finishedAt ?? w.startedAt).toISOString();

    for (const exEntry of w.exercises) {
      const exName = exercisesMap.get(exEntry.exerciseId)?.name ?? exEntry.exerciseId;
      for (const s of exEntry.sets) {
        if (!s.completed) continue;
        const e1rm =
          s.weightKg && s.reps ? calculateHybridE1RM(s.weightKg, s.reps) : '';
        rows.push(
          [
            csvEscape(dateStr),
            csvEscape(clientName),
            csvEscape(w.name),
            csvEscape(exName),
            csvEscape(s.setNumber),
            csvEscape(s.type),
            csvEscape(s.weightKg ?? 0),
            csvEscape(s.reps ?? 0),
            csvEscape(s.rpe ?? ''),
            csvEscape(e1rm),
            csvEscape(w.notes ?? ''),
          ].join(',')
        );
      }
    }
  }

  return rows.join('\n');
}

/**
 * RFC-4180 aware CSV line parser (handles quoted commas and escaped quotes).
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export type ExternalCsvFormat = 'strong' | 'hevy' | 'jefit' | 'tfit';

export function detectCsvFormat(headers: string[]): ExternalCsvFormat {
  const lower = headers.map((h) => h.toLowerCase());
  if (lower.includes('client name') && lower.includes('e1rm (kg)')) return 'tfit';
  if (lower.includes('start_time') && lower.includes('exercise_title')) return 'hevy';
  if (lower.includes('ename') || lower.includes('logs') || lower.includes('mydate')) return 'jefit';
  return 'strong';
}

export interface CsvImportResult {
  format: ExternalCsvFormat;
  workouts: Workout[];
  newExercises: Exercise[];
  importedSets: number;
}

/**
 * Lossless CSV Importer for Strong, Hevy, Jefit, and T! CSV exports.
 * Maps exercise titles cleanly to existing catalog (or creates custom exercises automatically).
 */
export function importExternalWorkoutsCsv(
  csvText: string,
  targetClientId: string,
  existingExercises: Exercise[]
): CsvImportResult {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    throw new Error('CSV file must contain a header row and at least one logged set.');
  }

  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const format = detectCsvFormat(headers);
  const col = (...candidates: string[]) =>
    candidates.map((c) => headers.indexOf(c)).find((idx) => idx >= 0) ?? -1;

  const dateIdx = col('date', 'start_time', 'mydate');
  const workoutIdx = col('workout name', 'title', 'workout_title');
  const exerciseIdx = col('exercise name', 'exercise_title', 'ename');
  const weightIdx = col('weight', 'weight (kg)', 'weight_kg', 'weight_lbs');
  const repsIdx = col('reps', 'rep');
  const rpeIdx = col('rpe');
  const setTypeIdx = col('set_type', 'set type', 'set order');
  const logsIdx = col('logs'); // Jefit stores sets like "100x8,100x8"

  const isLbs = headers.some((h) => h.includes('lbs') || h.includes('lb'));
  const byNameLower = new Map<string, Exercise>(
    existingExercises.map((e) => [e.name.toLowerCase(), e])
  );
  const newExercises: Exercise[] = [];

  const getOrCreateExercise = (name: string): string => {
    const clean = name.trim() || 'Imported Exercise';
    const existing = byNameLower.get(clean.toLowerCase());
    if (existing) return existing.id;
    const id = `ex-imp-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const created: Exercise = {
      id,
      name: clean,
      equipment: 'Barbell',
      movementPattern: 'isolation',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      bodyRegions: [],
      instructions: ['Imported via CSV. Edit muscles and equipment in Exercises tab.'],
      isCustom: true,
      updatedAt: Date.now(),
      deletedAt: null,
    };
    byNameLower.set(clean.toLowerCase(), created);
    newExercises.push(created);
    return id;
  };

  // Group sets by (dateKey + workoutName)
  const workoutGroups = new Map<
    string,
    { name: string; timestamp: number; exercises: Map<string, WorkoutSet[]> }
  >();

  let importedSets = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = dateIdx >= 0 ? r[dateIdx] : '';
    const parsedTs = Date.parse(rawDate);
    const ts = Number.isFinite(parsedTs) ? parsedTs : Date.now();
    const dateKey = new Date(ts).toISOString().slice(0, 10);
    const workoutName = (workoutIdx >= 0 ? r[workoutIdx] : '') || `Imported Workout (${dateKey})`;
    const exName = exerciseIdx >= 0 ? r[exerciseIdx] : '';
    if (!exName) continue;

    const exId = getOrCreateExercise(exName);
    const groupKey = `${dateKey}::${workoutName}`;
    if (!workoutGroups.has(groupKey)) {
      workoutGroups.set(groupKey, { name: workoutName, timestamp: ts, exercises: new Map() });
    }
    const group = workoutGroups.get(groupKey)!;
    if (!group.exercises.has(exId)) {
      group.exercises.set(exId, []);
    }
    const setList = group.exercises.get(exId)!;

    // Special handling for Jefit "logs" column ("80x10,80x9")
    if (format === 'jefit' && logsIdx >= 0 && r[logsIdx]) {
      const chunks = r[logsIdx].split(',');
      for (const chunk of chunks) {
        const [wRaw, repRaw] = chunk.trim().split(/x/i);
        const wNum = parseFloat(wRaw);
        const repNum = parseInt(repRaw, 10);
        if (!Number.isFinite(repNum) || repNum <= 0) continue;
        const weightKg = Number.isFinite(wNum) ? (isLbs ? Math.round((wNum / 2.20462) * 10) / 10 : wNum) : 0;
        setList.push({
          id: `imp-s-${i}-${setList.length}-${Math.random().toString(36).slice(2, 6)}`,
          setNumber: setList.length + 1,
          type: 'normal',
          weightKg,
          reps: repNum,
          completed: true,
          completedAt: ts,
        });
        importedSets++;
      }
      continue;
    }

    const rawW = weightIdx >= 0 ? parseFloat(r[weightIdx]) : 0;
    const rawReps = repsIdx >= 0 ? parseInt(r[repsIdx], 10) : 0;
    const rawRpe = rpeIdx >= 0 ? parseFloat(r[rpeIdx]) : NaN;
    if (!Number.isFinite(rawReps) || rawReps <= 0) continue;

    const weightKg = Number.isFinite(rawW)
      ? isLbs
        ? Math.round((rawW / 2.20462) * 10) / 10
        : rawW
      : 0;

    const rawType = (setTypeIdx >= 0 ? r[setTypeIdx] : '').toLowerCase();
    const setType: WorkoutSet['type'] =
      rawType.includes('warm') || rawType === 'w'
        ? 'W'
        : rawType.includes('drop') || rawType === 'd'
        ? 'D'
        : rawType.includes('fail') || rawType === 'f'
        ? 'F'
        : rawType.includes('myo') || rawType === 'm'
        ? 'M'
        : 'normal';

    setList.push({
      id: `imp-s-${i}-${Math.random().toString(36).slice(2, 6)}`,
      setNumber: setList.length + 1,
      type: setType,
      weightKg,
      reps: rawReps,
      rpe: Number.isFinite(rawRpe) ? rawRpe : null,
      completed: true,
      completedAt: ts,
    });
    importedSets++;
  }

  const now = Date.now();
  const workouts: Workout[] = [];

  for (const [, g] of workoutGroups) {
    const exercises: WorkoutExercise[] = [];
    let totalVolumeKg = 0;
    let effectiveSets = 0;

    for (const [exerciseId, sets] of g.exercises) {
      exercises.push({
        id: `imp-we-${Math.random().toString(36).slice(2, 8)}`,
        exerciseId,
        restSeconds: 120,
        sets,
      });
      for (const s of sets) {
        if (s.type !== 'W') {
          totalVolumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
          effectiveSets += getRpeStimulusFactor(s.rpe);
        }
      }
    }

    workouts.push({
      id: `imp-wk-${g.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      clientId: targetClientId,
      name: g.name,
      startedAt: g.timestamp,
      finishedAt: g.timestamp + 3600_000,
      status: 'completed',
      exercises,
      totalVolumeKg: Math.round(totalVolumeKg),
      effectiveSets: Math.round(effectiveSets * 10) / 10,
      prCount: 0,
      updatedAt: now,
      deletedAt: null,
    });
  }

  return { format, workouts, newExercises, importedSets };
}
