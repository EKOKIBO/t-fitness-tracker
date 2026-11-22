import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DEFAULT_SETTINGS,
  createFullBackupSnapshot,
  db,
  ensureDatabaseBootstrapped,
  generateId,
  updateSettings,
} from '../db/database';
import { runCloudDeltaSync } from '../db/syncClient';
import { calculateHybridE1RM, getRpeStimulusFactor } from '../engine/formulas';
import { evaluateProgression } from '../engine/progression';
import { exportSyncBackupFile } from '../engine/portability';
import type {
  AppSettings,
  AppTab,
  Client,
  ClientExerciseNote,
  Exercise,
  Program,
  ProgramDay,
  Routine,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../types/models';

export interface RestTimerState {
  workoutId: string;
  exerciseName: string;
  totalSeconds: number;
  endsAt: number;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: 'default' | 'positive' | 'danger' | 'pr';
}

export interface FinishSummary {
  workout: Workout;
  client: Client;
  progressionUpdates: Array<{ exerciseName: string; message: string }>;
  isLastSessionPrompt: boolean;
}

interface AppContextValue {
  ready: boolean;
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  settings: AppSettings;
  clients: Client[];
  activeClient: Client | null;
  exercises: Exercise[];
  exerciseMap: Map<string, Exercise>;
  activeWorkouts: Workout[];
  openWorkoutId: string | null;
  setOpenWorkoutId: (id: string | null) => void;
  restTimers: Record<string, RestTimerState>;
  startRestTimer: (workoutId: string, exerciseName: string, seconds: number) => void;
  adjustRestTimer: (workoutId: string, deltaSeconds: number) => void;
  clearRestTimer: (workoutId: string) => void;
  selectClient: (clientId: string) => Promise<void>;
  startEmptyWorkout: (clientId?: string) => Promise<string>;
  startFromRoutine: (routine: Routine, clientId?: string) => Promise<string>;
  startFromProgramDay: (
    program: Program,
    day: ProgramDay,
    enrollmentId: string,
    clientId?: string
  ) => Promise<string>;
  repeatLastWorkout: (clientId?: string) => Promise<string | null>;
  finishActiveWorkout: (workoutId: string) => Promise<FinishSummary | null>;
  discardActiveWorkout: (workoutId: string) => Promise<void>;
  finishSummary: FinishSummary | null;
  setFinishSummary: (s: FinishSummary | null) => void;
  triggerCloudSync: (silent?: boolean) => Promise<void>;
  syncing: boolean;
  isOnline: boolean;
  triggerEndOfDayBackupExport: (preferShare?: boolean) => Promise<void>;
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  isClientSwitcherOpen: boolean;
  setClientSwitcherOpen: (v: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function playRestChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.14, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.26);
    });
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch {
    // Ignore audio autoplay blocks
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<AppTab>('home');
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null);
  const [restTimers, setRestTimers] = useState<Record<string, RestTimerState>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isClientSwitcherOpen, setClientSwitcherOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [finishSummary, setFinishSummary] = useState<FinishSummary | null>(null);

  const firedTimersRef = useRef<Set<string>>(new Set());

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'default') => {
    const id = generateId('toast');
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  useEffect(() => {
    ensureDatabaseBootstrapped().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Poll active rest timers to ring chime cleanly at 0
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRestTimers((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [wid, timer] of Object.entries(prev)) {
          const timerKey = `${wid}:${timer.endsAt}`;
          if (timer.endsAt <= now) {
            if (!firedTimersRef.current.has(timerKey)) {
              firedTimersRef.current.add(timerKey);
              playRestChime();
              pushToast(`Rest complete · ${timer.exerciseName}`, 'positive');
            }
            delete next[wid];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [pushToast]);

  const rawSettings = useLiveQuery(async () => {
    if (!ready) return DEFAULT_SETTINGS;
    const row = await db.syncMeta.get('appSettings');
    return row && row.value
      ? { ...DEFAULT_SETTINGS, ...(row.value as Partial<AppSettings>) }
      : DEFAULT_SETTINGS;
  }, [ready]);

  const settings = rawSettings ?? DEFAULT_SETTINGS;

  const clients =
    useLiveQuery(
      () =>
        ready
          ? db.clients
              .filter((c) => !c.deletedAt)
              .sortBy('name')
              .then((list) =>
                list.sort((a, b) => (a.isPersonal ? -1 : b.isPersonal ? 1 : a.name.localeCompare(b.name)))
              )
          : [],
      [ready]
    ) ?? [];

  const exercises =
    useLiveQuery(
      () => (ready ? db.exercises.filter((e) => !e.deletedAt).sortBy('name') : []),
      [ready]
    ) ?? [];

  const exerciseMap = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  const activeWorkouts =
    useLiveQuery(
      () =>
        ready
          ? db.workouts
              .where('status')
              .equals('active')
              .filter((w) => !w.deletedAt)
              .sortBy('startedAt')
          : [],
      [ready]
    ) ?? [];

  const activeClient = useMemo(() => {
    if (clients.length === 0) return null;
    return clients.find((c) => c.id === settings.activeClientId) ?? clients[0];
  }, [clients, settings.activeClientId]);

  const updateAppSettings = useCallback(async (patch: Partial<AppSettings>) => {
    await updateSettings(patch);
  }, []);

  const triggerCloudSync = useCallback(
    async (silent = false) => {
      if (syncing) return;
      setSyncing(true);
      try {
        const res = await runCloudDeltaSync();
        if (!silent) {
          pushToast(res.message, res.ok ? 'positive' : 'default');
        }
      } catch (err) {
        if (!silent) {
          pushToast(
            `Sync failed: ${err instanceof Error ? err.message : 'Network error'}`,
            'danger'
          );
        }
      } finally {
        setSyncing(false);
      }
    },
    [pushToast, syncing]
  );

  // Opportunistic silent sync when coming back online
  useEffect(() => {
    if (ready && isOnline && settings.cloudSyncEnabled) {
      void triggerCloudSync(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isOnline, settings.cloudSyncEnabled]);

  const selectClient = useCallback(async (clientId: string) => {
    await updateSettings({ activeClientId: clientId });
  }, []);

  const startRestTimer = useCallback(
    (workoutId: string, exerciseName: string, seconds: number) => {
      if (seconds <= 0) return;
      setRestTimers((prev) => ({
        ...prev,
        [workoutId]: {
          workoutId,
          exerciseName,
          totalSeconds: seconds,
          endsAt: Date.now() + seconds * 1000,
        },
      }));
    },
    []
  );

  const adjustRestTimer = useCallback((workoutId: string, deltaSeconds: number) => {
    setRestTimers((prev) => {
      const cur = prev[workoutId];
      if (!cur) return prev;
      const remaining = Math.max(5, Math.round((cur.endsAt - Date.now()) / 1000) + deltaSeconds);
      return {
        ...prev,
        [workoutId]: {
          ...cur,
          totalSeconds: Math.max(cur.totalSeconds, remaining),
          endsAt: Date.now() + remaining * 1000,
        },
      };
    });
  }, []);

  const clearRestTimer = useCallback((workoutId: string) => {
    setRestTimers((prev) => {
      if (!prev[workoutId]) return prev;
      const next = { ...prev };
      delete next[workoutId];
      return next;
    });
  }, []);

  /**
   * Finds the client's most recent completed working sets for a given exercise
   * to hydrate Ghost Autofill PREVIOUS & progression engine targets.
   */
  const buildHydratedExercise = useCallback(
    async (
      clientId: string,
      exerciseId: string,
      defaultSets: number,
      defaultReps: number,
      restSeconds: number,
      supersetGroupId?: string | null,
      fallbackConfig?: ClientExerciseNote['progressionConfig']
    ): Promise<WorkoutExercise> => {
      const clientWorkouts = await db.workouts
        .where('clientId')
        .equals(clientId)
        .filter((w) => w.status === 'completed' && !w.deletedAt)
        .toArray();
      clientWorkouts.sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));

      let lastSets: WorkoutSet[] = [];
      for (const w of clientWorkouts) {
        const match = w.exercises.find((e) => e.exerciseId === exerciseId);
        if (match && match.sets.some((s) => s.completed)) {
          lastSets = match.sets.filter((s) => s.completed && s.type !== 'W');
          break;
        }
      }

      const note = await db.clientExerciseNotes.get(`${clientId}:${exerciseId}`);
      const progConfig =
        note?.progressionConfig && note.progressionConfig.mode !== 'none'
          ? note.progressionConfig
          : fallbackConfig;

      const prescription = progConfig ? evaluateProgression(progConfig, lastSets) : null;

      let sets: WorkoutSet[];
      if (prescription && prescription.sets.length > 0) {
        sets = prescription.sets.map((p, idx) => {
          const prev = lastSets[idx] ?? lastSets[lastSets.length - 1];
          return {
            id: generateId('set'),
            setNumber: idx + 1,
            type: 'normal',
            weightKg: null,
            reps: null,
            rpe: null,
            completed: false,
            isAmrap: p.isAmrap,
            targetWeightKg: p.weightKg > 0 ? p.weightKg : prev?.weightKg ?? null,
            targetReps: p.reps,
            targetRpe: p.targetRpe ?? null,
            prevWeightKg: prev?.weightKg ?? null,
            prevReps: prev?.reps ?? null,
          };
        });
      } else {
        const count = Math.max(1, defaultSets || lastSets.length || 3);
        sets = Array.from({ length: count }, (_, idx) => {
          const prev = lastSets[idx] ?? lastSets[lastSets.length - 1];
          return {
            id: generateId('set'),
            setNumber: idx + 1,
            type: 'normal',
            weightKg: null,
            reps: null,
            rpe: null,
            completed: false,
            targetWeightKg: prev?.weightKg ?? null,
            targetReps: prev?.reps ?? defaultReps,
            prevWeightKg: prev?.weightKg ?? null,
            prevReps: prev?.reps ?? null,
          };
        });
      }

      return {
        id: generateId('we'),
        exerciseId,
        supersetGroupId: supersetGroupId ?? null,
        restSeconds,
        sets,
        progressionNote: prescription?.summaryBadge,
      };
    },
    []
  );

  const startEmptyWorkout = useCallback(
    async (clientIdOverride?: string) => {
      const cid = clientIdOverride ?? activeClient?.id ?? 'client-personal';
      const now = Date.now();
      const workout: Workout = {
        id: generateId('wk'),
        clientId: cid,
        name: 'Quick Freestyle Session',
        startedAt: now,
        status: 'active',
        exercises: [],
        totalVolumeKg: 0,
        effectiveSets: 0,
        prCount: 0,
        updatedAt: now,
        deletedAt: null,
      };
      await db.workouts.put(workout);
      setOpenWorkoutId(workout.id);
      return workout.id;
    },
    [activeClient]
  );

  const startFromRoutine = useCallback(
    async (routine: Routine, clientIdOverride?: string) => {
      const cid = clientIdOverride ?? activeClient?.id ?? 'client-personal';
      const hydrated = await Promise.all(
        routine.exercises.map((re) =>
          buildHydratedExercise(
            cid,
            re.exerciseId,
            re.defaultSets,
            re.defaultReps,
            re.restSeconds,
            re.supersetGroupId,
            re.progressionConfig
          )
        )
      );
      const now = Date.now();
      const workout: Workout = {
        id: generateId('wk'),
        clientId: cid,
        routineId: routine.id,
        name: routine.name,
        startedAt: now,
        status: 'active',
        exercises: hydrated,
        totalVolumeKg: 0,
        effectiveSets: 0,
        prCount: 0,
        updatedAt: now,
        deletedAt: null,
      };
      await db.workouts.put(workout);
      setOpenWorkoutId(workout.id);
      return workout.id;
    },
    [activeClient, buildHydratedExercise]
  );

  const startFromProgramDay = useCallback(
    async (
      program: Program,
      day: ProgramDay,
      enrollmentId: string,
      clientIdOverride?: string
    ) => {
      const cid = clientIdOverride ?? activeClient?.id ?? 'client-personal';
      const hydrated = await Promise.all(
        day.exercises.map((re) =>
          buildHydratedExercise(
            cid,
            re.exerciseId,
            re.defaultSets,
            re.defaultReps,
            re.restSeconds,
            re.supersetGroupId,
            re.progressionConfig
          )
        )
      );
      const now = Date.now();
      const workout: Workout = {
        id: generateId('wk'),
        clientId: cid,
        programEnrollmentId: enrollmentId,
        name: `${program.name.split(' ')[0]} · ${day.name}`,
        startedAt: now,
        status: 'active',
        exercises: hydrated,
        totalVolumeKg: 0,
        effectiveSets: 0,
        prCount: 0,
        updatedAt: now,
        deletedAt: null,
      };
      await db.workouts.put(workout);
      setOpenWorkoutId(workout.id);
      return workout.id;
    },
    [activeClient, buildHydratedExercise]
  );

  const repeatLastWorkout = useCallback(
    async (clientIdOverride?: string) => {
      const cid = clientIdOverride ?? activeClient?.id;
      if (!cid) return null;
      const past = await db.workouts
        .where('clientId')
        .equals(cid)
        .filter((w) => w.status === 'completed' && !w.deletedAt)
        .toArray();
      past.sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
      const latest = past[0];
      if (!latest) {
        pushToast('No prior workout found for this client yet.', 'default');
        return null;
      }

      const hydrated = await Promise.all(
        latest.exercises.map((we) => {
          const workingCount = Math.max(
            1,
            we.sets.filter((s) => s.type !== 'W').length || we.sets.length
          );
          return buildHydratedExercise(
            cid,
            we.exerciseId,
            workingCount,
            we.sets[0]?.reps ?? 8,
            we.restSeconds,
            we.supersetGroupId
          );
        })
      );

      const now = Date.now();
      const workout: Workout = {
        id: generateId('wk'),
        clientId: cid,
        routineId: latest.routineId ?? null,
        name: latest.name,
        startedAt: now,
        status: 'active',
        exercises: hydrated,
        totalVolumeKg: 0,
        effectiveSets: 0,
        prCount: 0,
        updatedAt: now,
        deletedAt: null,
      };
      await db.workouts.put(workout);
      setOpenWorkoutId(workout.id);
      return workout.id;
    },
    [activeClient, buildHydratedExercise, pushToast]
  );

  const finishActiveWorkout = useCallback(
    async (workoutId: string): Promise<FinishSummary | null> => {
      const w = await db.workouts.get(workoutId);
      if (!w) return null;
      const client = (await db.clients.get(w.clientId)) ?? activeClient;
      if (!client) return null;

      // Load previous historical best e1RM per exercise for PR detection
      const history = await db.workouts
        .where('clientId')
        .equals(w.clientId)
        .filter((hw) => hw.status === 'completed' && !hw.deletedAt && hw.id !== w.id)
        .toArray();

      const bestHistoricalE1rm = new Map<string, number>();
      for (const hw of history) {
        for (const he of hw.exercises) {
          for (const hs of he.sets) {
            if (!hs.completed || hs.type === 'W' || !hs.weightKg || !hs.reps) continue;
            const e1 = calculateHybridE1RM(hs.weightKg, hs.reps);
            if (e1 > (bestHistoricalE1rm.get(he.exerciseId) ?? 0)) {
              bestHistoricalE1rm.set(he.exerciseId, e1);
            }
          }
        }
      }

      let totalVolumeKg = 0;
      let effectiveSets = 0;
      let prCount = 0;
      const progressionUpdates: Array<{ exerciseName: string; message: string }> = [];
      const now = Date.now();

      const finalizedExercises: WorkoutExercise[] = [];

      for (const we of w.exercises) {
        const prevBest = bestHistoricalE1rm.get(we.exerciseId) ?? 0;
        let runningBest = prevBest;

        const finalizedSets = we.sets.map((s) => {
          if (!s.completed) return s;
          if (s.type === 'W') return s;
          const wt = s.weightKg ?? 0;
          const reps = s.reps ?? 0;
          totalVolumeKg += wt * reps;
          effectiveSets += getRpeStimulusFactor(s.rpe);

          const e1 = wt > 0 && reps > 0 ? calculateHybridE1RM(wt, reps) : 0;
          let isPR = false;
          if (e1 > runningBest && prevBest > 0) {
            isPR = true;
            runningBest = e1;
            prCount++;
          } else if (e1 > runningBest) {
            runningBest = e1;
          }
          return { ...s, isPR };
        });

        finalizedExercises.push({ ...we, sets: finalizedSets });

        // Update progression state machine if configured for this client + exercise
        const noteId = `${w.clientId}:${we.exerciseId}`;
        const existingNote = await db.clientExerciseNotes.get(noteId);
        if (
          existingNote?.progressionConfig &&
          existingNote.progressionConfig.mode !== 'none'
        ) {
          const evalRes = evaluateProgression(existingNote.progressionConfig, finalizedSets);
          if (evalRes) {
            await db.clientExerciseNotes.put({
              ...existingNote,
              progressionConfig: evalRes.updatedConfig,
              updatedAt: now,
            });
            progressionUpdates.push({
              exerciseName: exerciseMap.get(we.exerciseId)?.name ?? we.exerciseId,
              message: evalRes.rationale,
            });
          }
        }
      }

      const completedWorkout: Workout = {
        ...w,
        exercises: finalizedExercises,
        status: 'completed',
        finishedAt: now,
        totalVolumeKg: Math.round(totalVolumeKg),
        effectiveSets: Math.round(effectiveSets * 10) / 10,
        prCount,
        updatedAt: now,
      };

      await db.workouts.put(completedWorkout);

      // Advance program enrollment if applicable
      if (w.programEnrollmentId) {
        const enr = await db.clientProgramEnrollments.get(w.programEnrollmentId);
        if (enr) {
          const prog = await db.programs.get(enr.programId);
          const daysPerWeek = prog?.days.length || 1;
          const nextDayIdx = (enr.currentDayIndex + 1) % daysPerWeek;
          const nextWeek = nextDayIdx === 0 ? enr.currentWeek + 1 : enr.currentWeek;
          await db.clientProgramEnrollments.put({
            ...enr,
            currentDayIndex: nextDayIdx,
            currentWeek: Math.min(prog?.weeksCount ?? nextWeek, nextWeek),
            completedDays: enr.completedDays + 1,
            updatedAt: now,
          });
        }
      }

      clearRestTimer(workoutId);

      // Update backup counter
      const curSettings = await updateSettings({
        workoutsSinceLastBackup: (settings.workoutsSinceLastBackup || 0) + 1,
      });

      // Switch to next remaining active parallel workout or close sheet
      const remainingActive = activeWorkouts.filter((aw) => aw.id !== workoutId);
      setOpenWorkoutId(remainingActive[0]?.id ?? null);

      const summary: FinishSummary = {
        workout: completedWorkout,
        client,
        progressionUpdates,
        isLastSessionPrompt: remainingActive.length === 0,
      };
      setFinishSummary(summary);

      if (curSettings.cloudSyncEnabled && isOnline) {
        void triggerCloudSync(true);
      }

      return summary;
    },
    [
      activeClient,
      activeWorkouts,
      clearRestTimer,
      exerciseMap,
      isOnline,
      settings.workoutsSinceLastBackup,
      triggerCloudSync,
    ]
  );

  const discardActiveWorkout = useCallback(
    async (workoutId: string) => {
      const w = await db.workouts.get(workoutId);
      if (w) {
        await db.workouts.delete(workoutId);
      }
      clearRestTimer(workoutId);
      const remaining = activeWorkouts.filter((aw) => aw.id !== workoutId);
      setOpenWorkoutId(remaining[0]?.id ?? null);
      pushToast('Active session discarded.', 'default');
    },
    [activeWorkouts, clearRestTimer, pushToast]
  );

  const triggerEndOfDayBackupExport = useCallback(
    async (preferShare = true) => {
      try {
        const snapshot = await createFullBackupSnapshot();
        const result = await exportSyncBackupFile(snapshot, preferShare);
        await updateSettings({
          lastBackupExportAt: Date.now(),
          workoutsSinceLastBackup: 0,
        });
        pushToast(
          result === 'shared'
            ? 'Daily sync backup ready to save to Files / iCloud.'
            : 'Daily sync backup (.tfit.json) downloaded!',
          'positive'
        );
      } catch (err) {
        pushToast(
          `Backup export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'danger'
        );
      }
    },
    [pushToast]
  );

  const value: AppContextValue = {
    ready,
    tab,
    setTab,
    settings,
    clients,
    activeClient,
    exercises,
    exerciseMap,
    activeWorkouts,
    openWorkoutId,
    setOpenWorkoutId,
    restTimers,
    startRestTimer,
    adjustRestTimer,
    clearRestTimer,
    selectClient,
    startEmptyWorkout,
    startFromRoutine,
    startFromProgramDay,
    repeatLastWorkout,
    finishActiveWorkout,
    discardActiveWorkout,
    finishSummary,
    setFinishSummary,
    triggerCloudSync,
    syncing,
    isOnline,
    triggerEndOfDayBackupExport,
    toasts,
    pushToast,
    isClientSwitcherOpen,
    setClientSwitcherOpen,
    isSettingsOpen,
    setSettingsOpen,
    updateAppSettings,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
