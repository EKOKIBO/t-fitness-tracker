import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  AlertTriangle,
  Award,
  Check,
  ChevronDown,
  ChevronUp,
  Disc3,
  Download,
  Image as ImageIcon,
  Link2,
  Pin,
  Plus,
  Search,
  Sparkles,
  Timer,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, generateId } from '../db/database';
import { computeMuscleVolume, type WarmupSetPrescription } from '../engine/formulas';
import { computeIntraSessionRpeAdjustment } from '../engine/progression';
import {
  BODY_REGION_LABELS,
  MUSCLE_LABELS,
  displayToKg,
  formatWeight,
  kgToDisplay,
  type MuscleGroup,
  type SetType,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '../types/models';
import { PlateCalculatorModal } from './PlateCalculatorModal';
import { ProgressCardModal } from './ProgressCardModal';

const SUPERSET_COLORS = ['#007AFF', '#10B981', '#FFB800', '#06B6D4'];
const RPE_OPTIONS = [
  { val: 6.0, hint: '4+ RIR' },
  { val: 6.5, hint: '3.5 RIR' },
  { val: 7.0, hint: '3 RIR' },
  { val: 7.5, hint: '2.5 RIR' },
  { val: 8.0, hint: '2 RIR' },
  { val: 8.5, hint: '1.5 RIR' },
  { val: 9.0, hint: '1 RIR' },
  { val: 9.5, hint: '0.5 RIR' },
  { val: 10.0, hint: '0 RIR' },
];

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ActiveWorkoutSheet() {
  const {
    activeWorkouts,
    openWorkoutId,
    setOpenWorkoutId,
    clients,
    exercises,
    exerciseMap,
    settings,
    restTimers,
    startRestTimer,
    adjustRestTimer,
    clearRestTimer,
    startEmptyWorkout,
    finishActiveWorkout,
    discardActiveWorkout,
    finishSummary,
    setFinishSummary,
    triggerEndOfDayBackupExport,
    pushToast,
  } = useApp();

  const [nowTick, setNowTick] = useState(Date.now());
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [exQuery, setExQuery] = useState('');
  const [parallelPickerOpen, setParallelPickerOpen] = useState(false);
  const [badgePopover, setBadgePopover] = useState<{
    weId: string;
    setId: string;
  } | null>(null);
  const [plateModal, setPlateModal] = useState<{
    weId: string;
    exerciseName: string;
    weightKg: number;
  } | null>(null);
  const [autoregBanner, setAutoregBanner] = useState<string | null>(null);
  const [shareCardClientId, setShareCardClientId] = useState<string | null>(null);

  const exerciseCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!openWorkoutId) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openWorkoutId]);

  const workout = useMemo(
    () => activeWorkouts.find((w) => w.id === openWorkoutId) ?? null,
    [activeWorkouts, openWorkoutId]
  );

  const client = useMemo(
    () => (workout ? clients.find((c) => c.id === workout.clientId) ?? null : null),
    [clients, workout]
  );

  // Live 7-day workouts for this client (for live collapsible muscle volume pill)
  const sevenDayWorkouts =
    useLiveQuery(async () => {
      if (!workout) return [];
      const cutoff = Date.now() - 7 * 86_400_000;
      return db.workouts
        .where('clientId')
        .equals(workout.clientId)
        .filter(
          (w) =>
            !w.deletedAt &&
            w.status === 'completed' &&
            (w.finishedAt ?? w.startedAt) >= cutoff
        )
        .toArray();
    }, [workout?.clientId]) ?? [];

  // Client setup notes for exercises in this workout
  const clientNotes =
    useLiveQuery(async () => {
      if (!workout) return [];
      return db.clientExerciseNotes
        .where('clientId')
        .equals(workout.clientId)
        .toArray();
    }, [workout?.clientId]) ?? [];

  const notesByExercise = useMemo(
    () => new Map(clientNotes.map((n) => [n.exerciseId, n])),
    [clientNotes]
  );

  const sessionMuscleVol = useMemo(
    () => (workout ? computeMuscleVolume([workout], exerciseMap) : null),
    [workout, exerciseMap]
  );

  const microcycleMuscleVol = useMemo(
    () =>
      workout
        ? computeMuscleVolume([...sevenDayWorkouts, workout], exerciseMap)
        : null,
    [sevenDayWorkouts, workout, exerciseMap]
  );

  const activeMusclesSorted = useMemo(() => {
    if (!sessionMuscleVol || !microcycleMuscleVol) return [];
    return (Object.keys(sessionMuscleVol) as MuscleGroup[])
      .map((m) => ({
        muscle: m,
        sessionRaw: sessionMuscleVol[m].rawSets,
        sessionEff: sessionMuscleVol[m].effectiveSets,
        weekEff: microcycleMuscleVol[m].effectiveSets,
      }))
      .filter((x) => x.sessionRaw > 0 || x.weekEff > 0)
      .sort((a, b) => b.sessionEff - a.sessionEff || b.weekEff - a.weekEff);
  }, [sessionMuscleVol, microcycleMuscleVol]);

  // Superset color index
  const supersetColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!workout) return map;
    let idx = 0;
    for (const we of workout.exercises) {
      if (we.supersetGroupId && !map.has(we.supersetGroupId)) {
        map.set(we.supersetGroupId, SUPERSET_COLORS[idx % SUPERSET_COLORS.length]);
        idx++;
      }
    }
    return map;
  }, [workout]);

  const filteredExercises = useMemo(() => {
    const q = exQuery.trim().toLowerCase();
    if (!q) return exercises.slice(0, 40);
    return exercises
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.equipment.toLowerCase().includes(q) ||
          e.primaryMuscles.some((m) => MUSCLE_LABELS[m].toLowerCase().includes(q))
      )
      .slice(0, 40);
  }, [exQuery, exercises]);

  const mutateWorkout = async (updater: (w: Workout) => Workout) => {
    if (!workout) return;
    const updated = { ...updater(workout), updatedAt: Date.now() };
    await db.workouts.put(updated);
  };

  const updateSet = async (
    weId: string,
    setId: string,
    patch: Partial<WorkoutSet>
  ) => {
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((we) =>
        we.id !== weId
          ? we
          : {
              ...we,
              sets: we.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
            }
      ),
    }));
  };

  const toggleSetComplete = async (we: WorkoutExercise, set: WorkoutSet) => {
    if (!workout || !client) return;
    const nextDone = !set.completed;

    // One-tap ghost autofill if empty when checking off
    const resolvedWeight =
      set.weightKg != null
        ? set.weightKg
        : set.targetWeightKg ?? set.prevWeightKg ?? 0;
    const resolvedReps =
      set.reps != null ? set.reps : set.targetReps ?? set.prevReps ?? 8;

    let nextAutoregMessage: string | null = null;

    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item) => {
        if (item.id !== we.id) return item;
        const setIdx = item.sets.findIndex((s) => s.id === set.id);
        const newSets = item.sets.map((s) =>
          s.id === set.id
            ? {
                ...s,
                weightKg: nextDone ? resolvedWeight : s.weightKg,
                reps: nextDone ? resolvedReps : s.reps,
                completed: nextDone,
                completedAt: nextDone ? Date.now() : null,
              }
            : s
        );

        // Mode D: Intra-session RPE autoregulation on next incomplete working set
        if (
          nextDone &&
          set.type !== 'W' &&
          set.rpe != null &&
          set.targetRpe != null &&
          resolvedWeight > 0
        ) {
          const adj = computeIntraSessionRpeAdjustment(
            resolvedWeight,
            set.targetRpe,
            set.rpe,
            2.5
          );
          if (adj.message) {
            const nextIncomplete = newSets.findIndex(
              (s, idx) => idx > setIdx && !s.completed && s.type !== 'W'
            );
            if (nextIncomplete >= 0) {
              newSets[nextIncomplete] = {
                ...newSets[nextIncomplete],
                targetWeightKg: adj.adjustedWeightKg,
              };
              nextAutoregMessage = adj.message;
            }
          }
        }

        return { ...item, sets: newSets };
      }),
    }));

    if (nextAutoregMessage) {
      setAutoregBanner(nextAutoregMessage);
      setTimeout(() => setAutoregBanner(null), 5500);
    }

    // Smart Superset Auto-Scroll & Rest Timer Logic
    if (nextDone && set.type !== 'W') {
      const exName = exerciseMap.get(we.exerciseId)?.name ?? 'Exercise';
      if (we.supersetGroupId) {
        const cluster = workout.exercises.filter(
          (item) => item.supersetGroupId === we.supersetGroupId
        );
        const myClusterIdx = cluster.findIndex((item) => item.id === we.id);
        const isLastInCluster = myClusterIdx === cluster.length - 1;
        if (!isLastInCluster) {
          const nextEx = cluster[myClusterIdx + 1];
          const el = exerciseCardRefs.current[nextEx.id];
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          pushToast(
            `Superset → Jump to ${exerciseMap.get(nextEx.exerciseId)?.name ?? 'next lift'}`,
            'default'
          );
          return; // Don't trigger rest timer until final exercise in superset completes!
        }
      }
      startRestTimer(workout.id, exName, we.restSeconds || 90);
    }
  };

  const applyRpeWithAutoreg = async (we: WorkoutExercise, set: WorkoutSet, rpeVal: number | null) => {
    await updateSet(we.id, set.id, { rpe: rpeVal });
    if (
      rpeVal != null &&
      set.targetRpe != null &&
      (set.weightKg ?? set.targetWeightKg ?? 0) > 0
    ) {
      const baseW = set.weightKg ?? set.targetWeightKg ?? 0;
      const adj = computeIntraSessionRpeAdjustment(baseW, set.targetRpe, rpeVal, 2.5);
      if (adj.message) {
        const setIdx = we.sets.findIndex((s) => s.id === set.id);
        const nextSet = we.sets.find((s, idx) => idx > setIdx && !s.completed && s.type !== 'W');
        if (nextSet) {
          await updateSet(we.id, nextSet.id, { targetWeightKg: adj.adjustedWeightKg });
          setAutoregBanner(adj.message);
          setTimeout(() => setAutoregBanner(null), 5500);
        }
      }
    }
  };

  const addSetToExercise = async (we: WorkoutExercise) => {
    const last = we.sets[we.sets.length - 1];
    const nextNum = we.sets.filter((s) => s.type !== 'W').length + 1;
    const newSet: WorkoutSet = {
      id: generateId('set'),
      setNumber: nextNum,
      type: 'normal',
      weightKg: null,
      reps: null,
      rpe: null,
      completed: false,
      targetWeightKg: last?.weightKg ?? last?.targetWeightKg ?? null,
      targetReps: last?.reps ?? last?.targetReps ?? 8,
      targetRpe: last?.targetRpe ?? null,
      prevWeightKg: last?.prevWeightKg ?? null,
      prevReps: last?.prevReps ?? null,
    };
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item) =>
        item.id === we.id ? { ...item, sets: [...item.sets, newSet] } : item
      ),
    }));
  };

  const insertWarmupsForExercise = async (
    weId: string,
    warmups: WarmupSetPrescription[]
  ) => {
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item) => {
        if (item.id !== weId) return item;
        const warmupSets: WorkoutSet[] = warmups.map((wu, idx) => ({
          id: generateId('set'),
          setNumber: idx + 1,
          type: 'W',
          weightKg: wu.weightKg,
          reps: wu.reps,
          rpe: null,
          completed: false,
          targetWeightKg: wu.weightKg,
          targetReps: wu.reps,
        }));
        const existingNonWarmup = item.sets.filter((s) => s.type !== 'W');
        return { ...item, sets: [...warmupSets, ...existingNonWarmup] };
      }),
    }));
    pushToast(`Added ${warmups.length} warm-up sets.`, 'pr');
  };

  const removeSet = async (weId: string, setId: string) => {
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item) =>
        item.id === weId
          ? { ...item, sets: item.sets.filter((s) => s.id !== setId) }
          : item
      ),
    }));
  };

  const toggleSupersetWithNext = async (index: number) => {
    if (!workout || index >= workout.exercises.length - 1) return;
    const curr = workout.exercises[index];
    const next = workout.exercises[index + 1];
    const sharedId = curr.supersetGroupId && curr.supersetGroupId === next.supersetGroupId
      ? null
      : curr.supersetGroupId || generateId('ss');

    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item, idx) =>
        idx === index || idx === index + 1
          ? { ...item, supersetGroupId: sharedId }
          : item
      ),
    }));
  };

  const addExerciseToWorkout = async (exerciseId: string) => {
    if (!workout) return;
    // Check last session for this client & exercise
    const history = await db.workouts
      .where('clientId')
      .equals(workout.clientId)
      .filter((hw) => hw.status === 'completed' && !hw.deletedAt)
      .toArray();
    history.sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
    let prevSets: WorkoutSet[] = [];
    for (const hw of history) {
      const m = hw.exercises.find((e) => e.exerciseId === exerciseId);
      if (m) {
        prevSets = m.sets.filter((s) => s.completed && s.type !== 'W');
        break;
      }
    }

    const sets: WorkoutSet[] = Array.from({ length: 3 }, (_, idx) => {
      const p = prevSets[idx] ?? prevSets[prevSets.length - 1];
      return {
        id: generateId('set'),
        setNumber: idx + 1,
        type: 'normal',
        weightKg: null,
        reps: null,
        rpe: null,
        completed: false,
        targetWeightKg: p?.weightKg ?? null,
        targetReps: p?.reps ?? 10,
        prevWeightKg: p?.weightKg ?? null,
        prevReps: p?.reps ?? null,
      };
    });

    const newWe: WorkoutExercise = {
      id: generateId('we'),
      exerciseId,
      restSeconds: 120,
      sets,
    };

    await mutateWorkout((w) => ({ ...w, exercises: [...w.exercises, newWe] }));
    setAddExerciseOpen(false);
    setExQuery('');
  };

  const saveSetupCue = async (exerciseId: string, cueText: string) => {
    if (!workout) return;
    const noteId = `${workout.clientId}:${exerciseId}`;
    const existing = await db.clientExerciseNotes.get(noteId);
    await db.clientExerciseNotes.put({
      id: noteId,
      clientId: workout.clientId,
      exerciseId,
      setupCue: cueText,
      progressionConfig: existing?.progressionConfig ?? { mode: 'none' },
      updatedAt: Date.now(),
      deletedAt: null,
    });
  };

  // === FINISH WORKOUT SUMMARY MODAL ===
  if (!workout && finishSummary) {
    const { workout: doneW, client: doneC, progressionUpdates, isLastSessionPrompt } = finishSummary;
    const mins = Math.max(1, Math.round(((doneW.finishedAt ?? Date.now()) - doneW.startedAt) / 60_000));

    return (
      <>
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <div>
                <h2 className="card-title">Session Complete — {doneC.name}</h2>
                <p className="card-meta tabular">
                  {doneW.name} · {mins} min
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setFinishSummary(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="kpi-grid">
                <div className="kpi-tile">
                  <span className="section-label">Volume Moved</span>
                  <span className="kpi-value tabular" style={{ color: 'var(--accent-primary)' }}>
                    {formatWeight(doneW.totalVolumeKg, doneC.unit)} {doneC.unit}
                  </span>
                </div>
                <div className="kpi-tile">
                  <span className="section-label">PRs / Effective Sets</span>
                  <span className="kpi-value tabular" style={{ color: doneW.prCount > 0 ? 'var(--accent-pr)' : 'var(--accent-positive)' }}>
                    {doneW.prCount} PR · {doneW.effectiveSets}
                  </span>
                </div>
              </div>

              {progressionUpdates.length > 0 && (
                <div className="card card-compact col" style={{ background: 'var(--bg-well)' }}>
                  <div className="row">
                    <Sparkles size={15} style={{ color: 'var(--accent-positive)' }} />
                    <span className="section-label">Algorithmic Next-Session Updates</span>
                  </div>
                  {progressionUpdates.map((u, i) => (
                    <div key={i} style={{ fontSize: 12.5 }}>
                      <strong>{u.exerciseName}:</strong>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>{u.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* End-of-Day Sync Backup Export Prompt */}
              {isLastSessionPrompt && (
                <div
                  className="card card-compact col"
                  style={{
                    background: 'rgba(255, 184, 0, 0.08)',
                    borderColor: 'rgba(255, 184, 0, 0.35)',
                  }}
                >
                  <div className="row-between">
                    <div>
                      <strong style={{ fontSize: 13.5, color: 'var(--accent-pr)' }}>
                        Last workout of the day?
                      </strong>
                      <p className="card-meta" style={{ marginTop: 2 }}>
                        Download a <code>.tfit.json</code> sync snapshot to Files / iCloud so you can restore all client logs instantly if data erasure ever occurs.
                      </p>
                    </div>
                  </div>
                  <button
                    id="finish-eod-backup-btn"
                    type="button"
                    className="btn btn-amber btn-full"
                    onClick={() => void triggerEndOfDayBackupExport(true)}
                  >
                    <Download size={15} /> Export Daily Sync Backup File (.tfit.json)
                  </button>
                </div>
              )}

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setShareCardClientId(doneC.id)}
                >
                  <ImageIcon size={15} /> Share Progress PNG
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => setFinishSummary(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>

        {shareCardClientId && (
          <ProgressCardModal
            open={true}
            clientId={shareCardClientId}
            onClose={() => setShareCardClientId(null)}
          />
        )}
      </>
    );
  }

  if (!workout || !client) return null;

  const timer = restTimers[workout.id];
  const timerRemainingSec = timer ? Math.max(0, Math.ceil((timer.endsAt - nowTick) / 1000)) : 0;
  const timerPct =
    timer && timer.totalSeconds > 0
      ? Math.min(100, Math.max(0, (timerRemainingSec / timer.totalSeconds) * 100))
      : 0;

  const totalCompletedSets = workout.exercises.reduce(
    (acc, we) => acc + we.sets.filter((s) => s.completed && s.type !== 'W').length,
    0
  );

  return (
    <div className="workout-sheet-overlay" role="dialog" aria-label="Active Workout Logger">
      {/* HEADER WITH PARALLEL CLIENT TABS */}
      <div className="workout-sheet-header">
        <div className="workout-sheet-toprow">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setOpenWorkoutId(null)}
          >
            <ChevronDown size={15} /> Minimize
          </button>

          <div style={{ textAlign: 'center', minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workout.name}
            </div>
            <div className="card-meta tabular">
              {formatDuration(nowTick - workout.startedAt)} · {totalCompletedSets} sets done
            </div>
          </div>

          <button
            id="finish-workout-btn"
            type="button"
            className="btn btn-positive btn-sm"
            onClick={() => void finishActiveWorkout(workout.id)}
          >
            <Check size={15} /> Finish
          </button>
        </div>

        {/* PARALLEL SEMI-PRIVATE CLIENT SESSIONS STRIP */}
        <div className="parallel-tabs-strip">
          {activeWorkouts.map((aw) => {
            const c = clients.find((x) => x.id === aw.clientId);
            const isCur = aw.id === workout.id;
            const t = restTimers[aw.id];
            const rem = t ? Math.max(0, Math.ceil((t.endsAt - nowTick) / 1000)) : 0;
            return (
              <button
                key={aw.id}
                type="button"
                className={`parallel-tab ${isCur ? 'active' : ''}`}
                onClick={() => setOpenWorkoutId(aw.id)}
              >
                <span
                  className="client-avatar"
                  style={{
                    width: 20,
                    height: 20,
                    fontSize: 9.5,
                    background: c?.avatarColor ?? '#007AFF',
                  }}
                >
                  {c?.avatarInitials ?? 'CL'}
                </span>
                <span>{c?.name.split(' ')[0] ?? 'Client'}</span>
                {rem > 0 && (
                  <span className="tabular" style={{ color: 'var(--accent-pr)', fontSize: 11 }}>
                    {formatDuration(rem * 1000)}
                  </span>
                )}
              </button>
            );
          })}

          <button
            id="add-parallel-client-btn"
            type="button"
            className="parallel-tab"
            onClick={() => setParallelPickerOpen(true)}
            title="Start a parallel session for a second semi-private client"
          >
            <UserPlus size={13} /> + Parallel Client
          </button>
        </div>

        {/* LIVE COLLAPSIBLE IN-SESSION MUSCLE VOLUME PILL */}
        <button
          type="button"
          className="card card-compact row-between"
          style={{
            background: 'var(--bg-well)',
            borderRadius: 'var(--radius-sm)',
            padding: '7px 11px',
            width: '100%',
            textAlign: 'left',
          }}
          onClick={() => setVolumeExpanded((v) => !v)}
        >
          <div className="row" style={{ minWidth: 0, overflow: 'hidden' }}>
            <Activity size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Live Volume:{' '}
              {activeMusclesSorted.slice(0, 3).length > 0
                ? activeMusclesSorted
                    .slice(0, 3)
                    .map((m) => `${MUSCLE_LABELS[m.muscle]} ${m.sessionEff} (${m.weekEff}/7d)`)
                    .join(' · ')
                : 'Complete a set to track fractional sets'}
            </span>
          </div>
          {volumeExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {volumeExpanded && (
          <div className="chip-row" style={{ paddingTop: 2 }}>
            {activeMusclesSorted.map((m) => (
              <span key={m.muscle} className="chip tabular">
                {MUSCLE_LABELS[m.muscle]}:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{m.sessionEff}</strong>
                <span style={{ color: 'var(--text-muted)' }}>({m.weekEff} / 7d)</span>
              </span>
            ))}
            {activeMusclesSorted.length === 0 && (
              <span className="card-meta">No working sets completed yet.</span>
            )}
          </div>
        )}
      </div>

      {/* MAIN SCROLLABLE EXERCISE STACK */}
      <div className="workout-sheet-body">
        {/* Session Name & 3-Second Readiness Tap */}
        <div className="card card-compact col" style={{ gap: 8 }}>
          <div className="row-between">
            <input
              type="text"
              value={workout.name}
              onChange={(e) =>
                void mutateWorkout((w) => ({ ...w, name: e.target.value }))
              }
              style={{
                background: 'transparent',
                border: 'none',
                fontWeight: 700,
                fontSize: 15,
                padding: 0,
                flex: 1,
              }}
            />
            <button
              type="button"
              className={`chip ${workout.readiness ? 'positive' : ''}`}
              onClick={() => setReadinessOpen((v) => !v)}
            >
              {workout.readiness
                ? `Readiness ${workout.readiness.sleep}/${workout.readiness.energy}/${workout.readiness.soreness}`
                : '3s Readiness Tap'}
            </button>
          </div>

          {readinessOpen && (
            <div className="col" style={{ gap: 6, paddingTop: 4 }}>
              {(
                [
                  { key: 'sleep', label: 'Sleep Quality' },
                  { key: 'energy', label: 'Energy / Drive' },
                  { key: 'soreness', label: 'Muscle Freshness (5 = Fresh)' },
                ] as const
              ).map(({ key, label }) => {
                const curVal = workout.readiness?.[key] ?? 0;
                return (
                  <div key={key} className="row-between">
                    <span className="card-meta">{label}</span>
                    <div className="row" style={{ gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`chip tabular ${curVal === n ? 'active' : ''}`}
                          style={{ padding: '4px 9px' }}
                          onClick={() =>
                            void mutateWorkout((w) => ({
                              ...w,
                              readiness: {
                                sleep: w.readiness?.sleep ?? 3,
                                energy: w.readiness?.energy ?? 3,
                                soreness: w.readiness?.soreness ?? 3,
                                [key]: n,
                              },
                            }))
                          }
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Real-Time Mode D RPE Autoregulation Alert */}
        {autoregBanner && (
          <div
            className="card card-compact row"
            style={{
              background: 'var(--accent-primary-soft)',
              borderColor: 'rgba(0, 122, 255, 0.45)',
              fontSize: 12.5,
            }}
          >
            <Sparkles size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <span>{autoregBanner}</span>
          </div>
        )}

        {/* Active Exercises */}
        {workout.exercises.map((we, exIndex) => {
          const ex = exerciseMap.get(we.exerciseId);
          const railColor = we.supersetGroupId ? supersetColorMap.get(we.supersetGroupId) : undefined;
          const noteRec = notesByExercise.get(we.exerciseId);
          const matchingInjuries =
            ex && client.injuries.length > 0
              ? client.injuries.filter((inj) => ex.bodyRegions.includes(inj.region))
              : [];

          const firstWorkingWeight =
            we.sets.find((s) => s.type !== 'W' && (s.weightKg ?? s.targetWeightKg))?.weightKg ??
            we.sets.find((s) => s.type !== 'W' && s.targetWeightKg)?.targetWeightKg ??
            100;

          const nextEx = workout.exercises[exIndex + 1];
          const isLinkedToNext = Boolean(
            we.supersetGroupId && nextEx && nextEx.supersetGroupId === we.supersetGroupId
          );

          return (
            <div
              key={we.id}
              ref={(el) => {
                exerciseCardRefs.current[we.id] = el;
              }}
              className={`exercise-block ${railColor ? 'in-superset' : ''}`}
            >
              {railColor && (
                <div className="superset-rail" style={{ background: railColor }} />
              )}

              {/* Exercise Header */}
              <div className="row-between" style={{ marginBottom: 4 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15, color: 'var(--accent-primary)' }}>
                      {ex?.name ?? we.exerciseId}
                    </strong>
                    {we.progressionNote && (
                      <span className="chip positive tabular" style={{ fontSize: 11, padding: '2px 8px' }}>
                        {we.progressionNote}
                      </span>
                    )}
                  </div>
                  <div className="card-meta">
                    {ex?.equipment} · Rest {we.restSeconds}s
                    {railColor && ' · Superset'}
                  </div>
                </div>

                <div className="row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Warm-Up Generator & IPF Barbell Plate Solver"
                    onClick={() =>
                      setPlateModal({
                        weId: we.id,
                        exerciseName: ex?.name ?? 'Barbell Lift',
                        weightKg: firstWorkingWeight,
                      })
                    }
                  >
                    <Disc3 size={15} />
                  </button>

                  {nextEx && (
                    <button
                      type="button"
                      className={`icon-btn ${isLinkedToNext ? 'accent' : ''}`}
                      title={
                        isLinkedToNext
                          ? 'Unlink superset with next exercise'
                          : 'Link as Superset with next exercise'
                      }
                      onClick={() => void toggleSupersetWithNext(exIndex)}
                    >
                      <Link2 size={15} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Remove exercise"
                    onClick={() =>
                      void mutateWorkout((w) => ({
                        ...w,
                        exercises: w.exercises.filter((x) => x.id !== we.id),
                      }))
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Injury Contraindication Banner */}
              {matchingInjuries.length > 0 && (
                <div className="injury-banner">
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Injury Alert ({client.name.split(' ')[0]}):</strong>{' '}
                    {matchingInjuries
                      .map((i) => `${i.label} (${BODY_REGION_LABELS[i.region]}, ${i.severity})`)
                      .join(' · ')}
                  </span>
                </div>
              )}

              {/* Sticky Client Equipment Setup & Cue Note */}
              <div className="setup-cue-bar">
                <Pin size={12} style={{ color: 'var(--accent-pr)', flexShrink: 0 }} />
                <input
                  type="text"
                  className="setup-cue-input"
                  placeholder="Pin client setup note (e.g., Seat pin #4 · Elbows 45°)"
                  defaultValue={noteRec?.setupCue ?? ''}
                  onBlur={(e) => void saveSetupCue(we.exerciseId, e.target.value)}
                />
              </div>

              {/* 5-Column Set Matrix */}
              <div className="set-matrix-head">
                <span>SET</span>
                <span>PREVIOUS</span>
                <span>{client.unit.toUpperCase()}</span>
                <span>REPS</span>
                <span>✓</span>
              </div>

              <div className="col" style={{ gap: 4 }}>
                {we.sets.map((s, sIdx) => {
                  const workingIndex = we.sets
                    .slice(0, sIdx + 1)
                    .filter((x) => x.type !== 'W').length;
                  const badgeLabel = s.type === 'normal' ? String(workingIndex) : s.type;
                  const prevText =
                    s.prevWeightKg != null && s.prevReps != null
                      ? `${formatWeight(s.prevWeightKg, client.unit)} × ${s.prevReps}`
                      : s.targetWeightKg != null && s.targetReps != null
                      ? `Target ${formatWeight(s.targetWeightKg, client.unit)} × ${s.targetReps}${s.isAmrap ? '+' : ''}`
                      : '—';

                  const weightPlaceholder =
                    s.targetWeightKg != null
                      ? formatWeight(s.targetWeightKg, client.unit)
                      : s.prevWeightKg != null
                      ? formatWeight(s.prevWeightKg, client.unit)
                      : '0';

                  const repsPlaceholder =
                    s.targetReps != null
                      ? `${s.targetReps}${s.isAmrap ? '+' : ''}`
                      : s.prevReps != null
                      ? String(s.prevReps)
                      : '0';

                  const isPopoverOpen =
                    badgePopover?.weId === we.id && badgePopover?.setId === s.id;

                  return (
                    <div key={s.id}>
                      <div className={`set-row ${s.completed ? 'completed' : ''}`}>
                        {/* Column 1: Contextual Set Badge */}
                        <button
                          type="button"
                          className={`set-badge-btn tabular type-${s.type}`}
                          onClick={() =>
                            setBadgePopover(
                              isPopoverOpen ? null : { weId: we.id, setId: s.id }
                            )
                          }
                          title="Tap to tag W/D/F/M or log RPE"
                        >
                          <span>{badgeLabel}</span>
                          {s.rpe != null && <span className="set-rpe-mini">@{s.rpe}</span>}
                        </button>

                        {/* Column 2: One-Tap PREVIOUS Ghost Copy */}
                        <button
                          type="button"
                          className="set-prev-btn tabular"
                          onClick={() => {
                            const wCopy = s.prevWeightKg ?? s.targetWeightKg;
                            const rCopy = s.prevReps ?? s.targetReps;
                            if (wCopy != null || rCopy != null) {
                              void updateSet(we.id, s.id, {
                                weightKg: wCopy ?? s.weightKg,
                                reps: rCopy ?? s.reps,
                              });
                            }
                          }}
                          title="Tap to copy previous/target values into this set"
                        >
                          {prevText}
                        </button>

                        {/* Column 3: Weight Input */}
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          className="set-input tabular"
                          placeholder={weightPlaceholder}
                          value={
                            s.weightKg != null ? kgToDisplay(s.weightKg, client.unit) : ''
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            void updateSet(we.id, s.id, {
                              weightKg: v === '' ? null : displayToKg(parseFloat(v), client.unit),
                            });
                          }}
                        />

                        {/* Column 4: Reps Input */}
                        <input
                          type="number"
                          inputMode="numeric"
                          className="set-input tabular"
                          placeholder={repsPlaceholder}
                          value={s.reps != null ? s.reps : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            void updateSet(we.id, s.id, {
                              reps: v === '' ? null : parseInt(v, 10),
                            });
                          }}
                        />

                        {/* Column 5: One-Tap Commit Check */}
                        <button
                          type="button"
                          className={`set-check-btn ${s.completed ? (s.isPR ? 'pr' : 'done') : ''}`}
                          onClick={() => void toggleSetComplete(we, s)}
                          aria-label={`Complete set ${badgeLabel}`}
                        >
                          {s.isPR ? <Award size={16} /> : <Check size={16} />}
                        </button>
                      </div>

                      {/* Contextual Set Badge & RPE/RIR Popover */}
                      {isPopoverOpen && (
                        <div
                          className="card card-compact col"
                          style={{
                            marginTop: 6,
                            marginBottom: 6,
                            background: '#191920',
                            borderColor: 'var(--border-strong)',
                          }}
                        >
                          <div className="row-between">
                            <span className="section-label">Set Type</span>
                            <button
                              type="button"
                              className="btn btn-danger-soft btn-sm"
                              onClick={() => {
                                setBadgePopover(null);
                                void removeSet(we.id, s.id);
                              }}
                            >
                              <Trash2 size={12} /> Delete Set
                            </button>
                          </div>
                          <div className="chip-row">
                            {(
                              [
                                { t: 'normal', label: 'Working' },
                                { t: 'W', label: 'W · Warm-Up' },
                                { t: 'D', label: 'D · Drop' },
                                { t: 'F', label: 'F · Failure' },
                                { t: 'M', label: 'M · Myo-Rep' },
                              ] as Array<{ t: SetType; label: string }>
                            ).map((opt) => (
                              <button
                                key={opt.t}
                                type="button"
                                className={`chip ${s.type === opt.t ? 'active' : ''}`}
                                onClick={() => void updateSet(we.id, s.id, { type: opt.t })}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          <div className="row-between" style={{ marginTop: 4 }}>
                            <span className="section-label">RPE / RIR Autoregulation</span>
                            {s.rpe != null && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => void applyRpeWithAutoreg(we, s, null)}
                              >
                                Clear RPE
                              </button>
                            )}
                          </div>
                          <div className="chip-row">
                            {RPE_OPTIONS.map((opt) => (
                              <button
                                key={opt.val}
                                type="button"
                                className={`chip tabular ${s.rpe === opt.val ? 'active' : ''}`}
                                onClick={() => {
                                  void applyRpeWithAutoreg(we, s, opt.val);
                                  setBadgePopover(null);
                                }}
                              >
                                {opt.val.toFixed(1)}{' '}
                                <span style={{ opacity: 0.7, fontSize: 10.5 }}>({opt.hint})</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm btn-full"
                style={{ marginTop: 10 }}
                onClick={() => void addSetToExercise(we)}
              >
                <Plus size={14} /> Add Set
              </button>
            </div>
          );
        })}

        {/* Add Exercise / Discard Actions */}
        <div className="row" style={{ gap: 8 }}>
          <button
            id="workout-add-exercise-btn"
            type="button"
            className="btn btn-primary"
            style={{ flex: 2 }}
            onClick={() => setAddExerciseOpen(true)}
          >
            <Plus size={16} /> Add Exercise
          </button>
          <button
            type="button"
            className="btn btn-danger-soft"
            style={{ flex: 1 }}
            onClick={() => void discardActiveWorkout(workout.id)}
          >
            Discard
          </button>
        </div>
      </div>

      {/* PERSISTENT FLOATING REST TIMER BAR */}
      {timer && timerRemainingSec > 0 && (
        <div className="floating-timer">
          <div className="row" style={{ minWidth: 0 }}>
            <Timer size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div className="tabular" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                {formatDuration(timerRemainingSec * 1000)}
              </div>
              <div
                className="card-meta"
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {timer.exerciseName}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm tabular"
              onClick={() => adjustRestTimer(workout.id, -15)}
            >
              -15s
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm tabular"
              onClick={() => adjustRestTimer(workout.id, 15)}
            >
              +15s
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => clearRestTimer(workout.id)}
            >
              Skip
            </button>
          </div>

          <div className="timer-progress-track">
            <div className="timer-progress-fill" style={{ width: `${timerPct}%` }} />
          </div>
        </div>
      )}

      {/* ADD EXERCISE PICKER MODAL */}
      {addExerciseOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddExerciseOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="card-title">Add Exercise to {client.name.split(' ')[0]}'s Session</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setAddExerciseOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ position: 'relative' }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search barbell, cable, chest, squat..."
                  value={exQuery}
                  onChange={(e) => setExQuery(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px 10px 34px', fontSize: 14 }}
                />
              </div>

              <div className="col" style={{ gap: 6 }}>
                {filteredExercises.map((ex) => {
                  const hasFlag = client.injuries.some((inj) =>
                    ex.bodyRegions.includes(inj.region)
                  );
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      className="card card-compact row-between"
                      style={{ textAlign: 'left', width: '100%' }}
                      onClick={() => void addExerciseToWorkout(ex.id)}
                    >
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <strong style={{ fontSize: 14 }}>{ex.name}</strong>
                          {hasFlag && (
                            <AlertTriangle size={13} style={{ color: 'var(--accent-danger)' }} />
                          )}
                        </div>
                        <div className="card-meta">
                          {ex.equipment} ·{' '}
                          {ex.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
                        </div>
                      </div>
                      <Plus size={16} style={{ color: 'var(--accent-primary)' }} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD PARALLEL SEMI-PRIVATE CLIENT MODAL */}
      {parallelPickerOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setParallelPickerOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <div>
                <h2 className="card-title">Add Parallel Client Session</h2>
                <p className="card-meta">Run multiple semi-private sessions side by side</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setParallelPickerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="col">
                {clients
                  .filter((c) => !activeWorkouts.some((aw) => aw.clientId === c.id))
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="card card-compact row-between"
                      style={{ textAlign: 'left', width: '100%' }}
                      onClick={() => {
                        setParallelPickerOpen(false);
                        void startEmptyWorkout(c.id);
                      }}
                    >
                      <div className="row">
                        <span
                          className="client-avatar"
                          style={{ background: c.avatarColor }}
                        >
                          {c.avatarInitials}
                        </span>
                        <strong>{c.name}</strong>
                      </div>
                      <span className="chip active">Start Parallel</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WARM-UP & IPF BARBELL PLATE SOLVER */}
      {plateModal && (
        <PlateCalculatorModal
          open={true}
          onClose={() => setPlateModal(null)}
          initialWeightKg={plateModal.weightKg}
          barWeightKg={settings.barbellWeightKg}
          plateInventoryKg={settings.plateInventoryKg}
          unit={client.unit}
          exerciseName={plateModal.exerciseName}
          onInsertWarmups={(warmups) => void insertWarmupsForExercise(plateModal.weId, warmups)}
        />
      )}
    </div>
  );
}
