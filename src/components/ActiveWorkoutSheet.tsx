import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  ChevronDown,
  Disc3,
  Download,
  Image as ImageIcon,
  Link2,
  Plus,
  Search,
  Trash2,
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

const SUPERSET_RAILS = ['#007AFF', '#30D158', '#FF9F0A', '#64D2FF'];
const RPE_OPTIONS = [
  { val: 6.0, hint: '4+ RIR' },
  { val: 6.5, hint: '3.5' },
  { val: 7.0, hint: '3 RIR' },
  { val: 7.5, hint: '2.5' },
  { val: 8.0, hint: '2 RIR' },
  { val: 8.5, hint: '1.5' },
  { val: 9.0, hint: '1 RIR' },
  { val: 9.5, hint: '0.5' },
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

  const [nowTick, setNowTick] = useState(() => Date.now());
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [exQuery, setExQuery] = useState('');
  const [parallelPickerOpen, setParallelPickerOpen] = useState(false);
  const [badgePopover, setBadgePopover] = useState<{ weId: string; setId: string } | null>(null);
  const [plateModal, setPlateModal] = useState<{
    weId: string;
    exerciseName: string;
    weightKg: number;
  } | null>(null);
  const [autoregNote, setAutoregNote] = useState<string | null>(null);
  const [shareCardClientId, setShareCardClientId] = useState<string | null>(null);

  const exerciseRefs = useRef<Record<string, HTMLElement | null>>({});

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

  const clientNotes =
    useLiveQuery(async () => {
      if (!workout) return [];
      return db.clientExerciseNotes.where('clientId').equals(workout.clientId).toArray();
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
      workout ? computeMuscleVolume([...sevenDayWorkouts, workout], exerciseMap) : null,
    [sevenDayWorkouts, workout, exerciseMap]
  );

  const activeMuscles = useMemo(() => {
    if (!sessionMuscleVol || !microcycleMuscleVol) return [];
    return (Object.keys(sessionMuscleVol) as MuscleGroup[])
      .map((m) => ({
        muscle: m,
        sessionEff: sessionMuscleVol[m].effectiveSets,
        weekEff: microcycleMuscleVol[m].effectiveSets,
      }))
      .filter((x) => x.sessionEff > 0 || x.weekEff > 0)
      .sort((a, b) => b.sessionEff - a.sessionEff || b.weekEff - a.weekEff);
  }, [sessionMuscleVol, microcycleMuscleVol]);

  const supersetColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!workout) return map;
    let idx = 0;
    for (const we of workout.exercises) {
      if (we.supersetGroupId && !map.has(we.supersetGroupId)) {
        map.set(we.supersetGroupId, SUPERSET_RAILS[idx % SUPERSET_RAILS.length]);
        idx++;
      }
    }
    return map;
  }, [workout]);

  const filteredExercises = useMemo(() => {
    const q = exQuery.trim().toLowerCase();
    if (!q) return exercises.slice(0, 45);
    return exercises
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.equipment.toLowerCase().includes(q) ||
          e.primaryMuscles.some((m) => MUSCLE_LABELS[m].toLowerCase().includes(q))
      )
      .slice(0, 45);
  }, [exQuery, exercises]);

  const mutateWorkout = async (updater: (w: Workout) => Workout) => {
    if (!workout) return;
    await db.workouts.put({ ...updater(workout), updatedAt: Date.now() });
  };

  const updateSet = async (weId: string, setId: string, patch: Partial<WorkoutSet>) => {
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((we) =>
        we.id !== weId
          ? we
          : { ...we, sets: we.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }
      ),
    }));
  };

  const toggleSetComplete = async (we: WorkoutExercise, set: WorkoutSet) => {
    if (!workout || !client) return;
    const nextDone = !set.completed;
    const resolvedWeight =
      set.weightKg != null ? set.weightKg : set.targetWeightKg ?? set.prevWeightKg ?? 0;
    const resolvedReps =
      set.reps != null ? set.reps : set.targetReps ?? set.prevReps ?? 8;

    let nextAutoreg: string | null = null;

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
            const nextIdx = newSets.findIndex(
              (s, idx) => idx > setIdx && !s.completed && s.type !== 'W'
            );
            if (nextIdx >= 0) {
              newSets[nextIdx] = { ...newSets[nextIdx], targetWeightKg: adj.adjustedWeightKg };
              nextAutoreg = adj.message;
            }
          }
        }
        return { ...item, sets: newSets };
      }),
    }));

    if (nextAutoreg) {
      setAutoregNote(nextAutoreg);
      setTimeout(() => setAutoregNote(null), 5000);
    }

    if (nextDone && set.type !== 'W') {
      const exName = exerciseMap.get(we.exerciseId)?.name ?? 'Rest';
      if (we.supersetGroupId) {
        const cluster = workout.exercises.filter(
          (item) => item.supersetGroupId === we.supersetGroupId
        );
        const myIdx = cluster.findIndex((item) => item.id === we.id);
        if (myIdx < cluster.length - 1) {
          const nextEx = cluster[myIdx + 1];
          exerciseRefs.current[nextEx.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      startRestTimer(workout.id, exName, we.restSeconds || 90);
    }
  };

  const applyRpeWithAutoreg = async (
    we: WorkoutExercise,
    set: WorkoutSet,
    rpeVal: number | null
  ) => {
    await updateSet(we.id, set.id, { rpe: rpeVal });
    if (
      rpeVal != null &&
      set.targetRpe != null &&
      (set.weightKg ?? set.targetWeightKg ?? 0) > 0
    ) {
      const adj = computeIntraSessionRpeAdjustment(
        set.weightKg ?? set.targetWeightKg ?? 0,
        set.targetRpe,
        rpeVal,
        2.5
      );
      if (adj.message) {
        const idx = we.sets.findIndex((s) => s.id === set.id);
        const nextSet = we.sets.find((s, i) => i > idx && !s.completed && s.type !== 'W');
        if (nextSet) {
          await updateSet(we.id, nextSet.id, { targetWeightKg: adj.adjustedWeightKg });
          setAutoregNote(adj.message);
          setTimeout(() => setAutoregNote(null), 5000);
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

  const insertWarmupsForExercise = async (weId: string, warmups: WarmupSetPrescription[]) => {
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
        return {
          ...item,
          sets: [...warmupSets, ...item.sets.filter((s) => s.type !== 'W')],
        };
      }),
    }));
    pushToast(`Added ${warmups.length} warm-up sets.`);
  };

  const removeSet = async (weId: string, setId: string) => {
    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item) =>
        item.id === weId ? { ...item, sets: item.sets.filter((s) => s.id !== setId) } : item
      ),
    }));
  };

  const toggleSupersetWithNext = async (index: number) => {
    if (!workout || index >= workout.exercises.length - 1) return;
    const curr = workout.exercises[index];
    const next = workout.exercises[index + 1];
    const sharedId =
      curr.supersetGroupId && curr.supersetGroupId === next.supersetGroupId
        ? null
        : curr.supersetGroupId || generateId('ss');

    await mutateWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((item, idx) =>
        idx === index || idx === index + 1 ? { ...item, supersetGroupId: sharedId } : item
      ),
    }));
  };

  const addExerciseToWorkout = async (exerciseId: string) => {
    if (!workout) return;
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

    await mutateWorkout((w) => ({
      ...w,
      exercises: [...w.exercises, { id: generateId('we'), exerciseId, restSeconds: 120, sets }],
    }));
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

  // === FINISH WORKOUT SUMMARY SHEET ===
  if (!workout && finishSummary) {
    const { workout: doneW, client: doneC, progressionUpdates, isLastSessionPrompt } = finishSummary;
    const mins = Math.max(
      1,
      Math.round(((doneW.finishedAt ?? doneW.startedAt + 60_000) - doneW.startedAt) / 60_000)
    );

    return (
      <>
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Workout Saved</h2>
                <div className="row-sub tabular">
                  {doneC.name} · {mins} min
                </div>
              </div>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setFinishSummary(null)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <div className="modal-body">
              <div className="metrics-strip">
                <div className="metric-cell">
                  <span className="metric-label">Volume</span>
                  <span className="metric-value tabular">
                    {formatWeight(doneW.totalVolumeKg, doneC.unit)}
                    <span className="metric-unit">{doneC.unit}</span>
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Sets · PRs</span>
                  <span className="metric-value tabular">
                    {doneW.effectiveSets}
                    {doneW.prCount > 0 ? ` · ${doneW.prCount}` : ''}
                  </span>
                </div>
              </div>

              {progressionUpdates.length > 0 && (
                <div className="section-block">
                  <span className="section-label">Next Session Targets</span>
                  <div className="list-group">
                    {progressionUpdates.map((u, i) => (
                      <div key={i} className="list-row">
                        <div className="list-row-body">
                          <span className="row-title">{u.exerciseName}</span>
                          <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                            {u.message}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isLastSessionPrompt && (
                <div className="list-group">
                  <button
                    id="finish-eod-backup-btn"
                    type="button"
                    className="list-row interactive"
                    onClick={() => void triggerEndOfDayBackupExport(true)}
                  >
                    <div className="list-row-body">
                      <span className="row-title">Export Daily Sync File</span>
                      <span className="row-sub">
                        Save <code>.tfit.json</code> backup after last workout
                      </span>
                    </div>
                    <Download size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  </button>
                </div>
              )}

              <div className="field-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShareCardClientId(doneC.id)}
                >
                  <ImageIcon size={16} /> Share PNG
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
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

  const completedCount = workout.exercises.reduce(
    (acc, we) => acc + we.sets.filter((s) => s.completed && s.type !== 'W').length,
    0
  );

  return (
    <div className="workout-sheet" role="dialog" aria-label="Active Workout">
      {/* Compact Hevy Header */}
      <div className="workout-header">
        <div className="workout-header-bar">
          <button
            type="button"
            className="nav-icon-btn"
            onClick={() => setOpenWorkoutId(null)}
            aria-label="Minimize workout"
          >
            <ChevronDown size={22} />
          </button>

          <div style={{ textAlign: 'center', minWidth: 0, flex: 1 }}>
            <input
              type="text"
              value={workout.name}
              onChange={(e) => void mutateWorkout((w) => ({ ...w, name: e.target.value }))}
              style={{
                background: 'transparent',
                border: 'none',
                textAlign: 'center',
                fontWeight: 700,
                fontSize: 15,
                width: '100%',
                padding: 0,
              }}
            />
            <div className="row-sub tabular" style={{ fontSize: 12 }}>
              {formatDuration(nowTick - workout.startedAt)} · {completedCount} sets
            </div>
          </div>

          <button
            id="finish-workout-btn"
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void finishActiveWorkout(workout.id)}
          >
            Finish
          </button>
        </div>

        {/* Parallel Semi-Private Client Switcher Strip */}
        <div className="parallel-strip">
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
                <span>{c?.name.split(' ')[0] ?? 'Client'}</span>
                {rem > 0 && <span className="tabular">{formatDuration(rem * 1000)}</span>}
              </button>
            );
          })}
          <button
            id="add-parallel-client-btn"
            type="button"
            className="parallel-tab"
            onClick={() => setParallelPickerOpen(true)}
          >
            <Plus size={14} /> Client
          </button>
        </div>

        {/* Minimal Utility Strip (Live Volume + 3s Readiness) */}
        <div className="workout-meta-strip">
          <button
            type="button"
            className="tabular"
            style={{
              minHeight: 34,
              color: volumeExpanded ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 12.5,
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onClick={() => setVolumeExpanded((v) => !v)}
          >
            {activeMuscles.length > 0
              ? `Volume: ${activeMuscles
                  .slice(0, 3)
                  .map((m) => `${MUSCLE_LABELS[m.muscle]} ${m.sessionEff}`)
                  .join(' · ')}`
              : 'Live Volume'}
          </button>

          <button
            type="button"
            className="tabular"
            style={{
              minHeight: 34,
              color: workout.readiness ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12.5,
              fontWeight: 600,
              flexShrink: 0,
            }}
            onClick={() => setReadinessOpen((v) => !v)}
          >
            {workout.readiness
              ? `Readiness ${workout.readiness.sleep}/${workout.readiness.energy}/${workout.readiness.soreness}`
              : 'Readiness'}
          </button>
        </div>

        {volumeExpanded && (
          <div className="pill-row" style={{ padding: '0 4px 4px' }}>
            {activeMuscles.length > 0 ? (
              activeMuscles.map((m) => (
                <span key={m.muscle} className="pill tabular" style={{ minHeight: 28, fontSize: 12 }}>
                  {MUSCLE_LABELS[m.muscle]} {m.sessionEff} ({m.weekEff}/7d)
                </span>
              ))
            ) : (
              <span className="row-sub">Log a working set to track fractional sets.</span>
            )}
          </div>
        )}

        {readinessOpen && (
          <div className="col" style={{ gap: 6, padding: '4px 4px 6px' }}>
            {(
              [
                { key: 'sleep', label: 'Sleep' },
                { key: 'energy', label: 'Energy' },
                { key: 'soreness', label: 'Freshness' },
              ] as const
            ).map(({ key, label }) => {
              const curVal = workout.readiness?.[key] ?? 0;
              return (
                <div key={key} className="row-between">
                  <span className="row-sub">{label}</span>
                  <div className="row" style={{ gap: 4 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`pill tabular ${curVal === n ? 'active' : ''}`}
                        style={{ minHeight: 30, padding: '0 10px' }}
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

      {/* Flush Exercise Stack */}
      <div className="workout-body">
        {autoregNote && (
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-hairline)',
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {autoregNote}
          </div>
        )}

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
            <section
              key={we.id}
              ref={(el) => {
                exerciseRefs.current[we.id] = el;
              }}
              className={`exercise-section ${railColor ? 'in-superset' : ''}`}
            >
              {railColor && <div className="superset-rail" style={{ background: railColor }} />}

              <div className="row-between">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="exercise-title-btn">{ex?.name ?? we.exerciseId}</div>
                  {we.progressionNote && (
                    <div className="row-sub tabular" style={{ marginTop: 2 }}>
                      {we.progressionNote}
                    </div>
                  )}
                </div>

                <div className="row" style={{ gap: 0 }}>
                  <button
                    type="button"
                    className="nav-icon-btn"
                    title="Plates & Warm-Up"
                    onClick={() =>
                      setPlateModal({
                        weId: we.id,
                        exerciseName: ex?.name ?? 'Barbell Lift',
                        weightKg: firstWorkingWeight,
                      })
                    }
                  >
                    <Disc3 size={18} />
                  </button>

                  {nextEx && (
                    <button
                      type="button"
                      className={`nav-icon-btn ${isLinkedToNext ? 'accent' : ''}`}
                      title="Link Superset"
                      onClick={() => void toggleSupersetWithNext(exIndex)}
                    >
                      <Link2 size={18} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="nav-icon-btn"
                    title="Remove Exercise"
                    onClick={() =>
                      void mutateWorkout((w) => ({
                        ...w,
                        exercises: w.exercises.filter((x) => x.id !== we.id),
                      }))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              {matchingInjuries.length > 0 && (
                <div className="injury-line">
                  <span className="status-dot danger" />
                  <span>
                    {matchingInjuries
                      .map((i) => `${i.label} (${BODY_REGION_LABELS[i.region]})`)
                      .join(' · ')}
                  </span>
                </div>
              )}

              <input
                type="text"
                className="cue-inline-input"
                placeholder="Add setup cue (e.g., Pin #4, grip width)..."
                defaultValue={noteRec?.setupCue ?? ''}
                onBlur={(e) => void saveSetupCue(we.exerciseId, e.target.value)}
              />

              {/* Hevy-Exact 5-Column Set Matrix */}
              <div className="set-matrix-head">
                <span>SET</span>
                <span>PREVIOUS</span>
                <span>{client.unit.toUpperCase()}</span>
                <span>REPS</span>
                <span>✓</span>
              </div>

              {we.sets.map((s, sIdx) => {
                const workingIndex = we.sets
                  .slice(0, sIdx + 1)
                  .filter((x) => x.type !== 'W').length;
                const badgeLabel = s.type === 'normal' ? String(workingIndex) : s.type;
                const prevText =
                  s.prevWeightKg != null && s.prevReps != null
                    ? `${formatWeight(s.prevWeightKg, client.unit)} × ${s.prevReps}`
                    : s.targetWeightKg != null && s.targetReps != null
                    ? `${formatWeight(s.targetWeightKg, client.unit)} × ${s.targetReps}${s.isAmrap ? '+' : ''}`
                    : '—';

                const wPh =
                  s.targetWeightKg != null
                    ? formatWeight(s.targetWeightKg, client.unit)
                    : s.prevWeightKg != null
                    ? formatWeight(s.prevWeightKg, client.unit)
                    : '0';

                const rPh =
                  s.targetReps != null
                    ? `${s.targetReps}${s.isAmrap ? '+' : ''}`
                    : s.prevReps != null
                    ? String(s.prevReps)
                    : '0';

                const isPopOpen = badgePopover?.weId === we.id && badgePopover?.setId === s.id;

                return (
                  <div key={s.id}>
                    <div className={`set-row ${s.completed ? 'completed' : ''}`}>
                      <button
                        type="button"
                        className={`set-badge-btn tabular type-${s.type}`}
                        onClick={() =>
                          setBadgePopover(isPopOpen ? null : { weId: we.id, setId: s.id })
                        }
                      >
                        <span>{badgeLabel}</span>
                        {s.rpe != null && <span className="set-rpe-mini">@{s.rpe}</span>}
                      </button>

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
                      >
                        {prevText}
                      </button>

                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        className="set-input tabular"
                        placeholder={wPh}
                        value={s.weightKg != null ? kgToDisplay(s.weightKg, client.unit) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          void updateSet(we.id, s.id, {
                            weightKg: v === '' ? null : displayToKg(parseFloat(v), client.unit),
                          });
                        }}
                      />

                      <input
                        type="number"
                        inputMode="numeric"
                        className="set-input tabular"
                        placeholder={rPh}
                        value={s.reps != null ? s.reps : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          void updateSet(we.id, s.id, {
                            reps: v === '' ? null : parseInt(v, 10),
                          });
                        }}
                      />

                      <button
                        type="button"
                        className={`set-check-btn ${s.completed ? 'done' : ''}`}
                        onClick={() => void toggleSetComplete(we, s)}
                        aria-label={`Complete set ${badgeLabel}`}
                      >
                        <Check size={17} strokeWidth={2.5} />
                      </button>
                    </div>

                    {isPopOpen && (
                      <div className="set-popover">
                        <div className="row-between">
                          <span className="section-label">Set Tag</span>
                          <button
                            type="button"
                            className="btn-text danger"
                            style={{ minHeight: 32, fontSize: 13 }}
                            onClick={() => {
                              setBadgePopover(null);
                              void removeSet(we.id, s.id);
                            }}
                          >
                            Remove Set
                          </button>
                        </div>
                        <div className="pill-row">
                          {(
                            [
                              { t: 'normal', label: 'Working' },
                              { t: 'W', label: 'Warm-Up' },
                              { t: 'D', label: 'Drop' },
                              { t: 'F', label: 'Failure' },
                              { t: 'M', label: 'Myo-Rep' },
                            ] as Array<{ t: SetType; label: string }>
                          ).map((opt) => (
                            <button
                              key={opt.t}
                              type="button"
                              className={`pill ${s.type === opt.t ? 'active' : ''}`}
                              onClick={() => void updateSet(we.id, s.id, { type: opt.t })}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        <div className="row-between">
                          <span className="section-label">RPE</span>
                          {s.rpe != null && (
                            <button
                              type="button"
                              className="btn-text muted"
                              style={{ minHeight: 28, fontSize: 12.5 }}
                              onClick={() => void applyRpeWithAutoreg(we, s, null)}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="pill-row">
                          {RPE_OPTIONS.map((opt) => (
                            <button
                              key={opt.val}
                              type="button"
                              className={`pill tabular ${s.rpe === opt.val ? 'active' : ''}`}
                              onClick={() => {
                                void applyRpeWithAutoreg(we, s, opt.val);
                                setBadgePopover(null);
                              }}
                            >
                              {opt.val.toFixed(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                className="btn btn-secondary btn-full"
                style={{ marginTop: 10 }}
                onClick={() => void addSetToExercise(we)}
              >
                <Plus size={16} /> Add Set
              </button>
            </section>
          );
        })}

        {/* Bottom Actions */}
        <div className="col" style={{ padding: '20px 16px', gap: 10 }}>
          <button
            id="workout-add-exercise-btn"
            type="button"
            className="btn btn-primary btn-full"
            onClick={() => setAddExerciseOpen(true)}
          >
            <Plus size={18} /> Add Exercise
          </button>
          <button
            type="button"
            className="btn btn-danger-text btn-full"
            onClick={() => void discardActiveWorkout(workout.id)}
          >
            Discard Workout
          </button>
        </div>
      </div>

      {/* Floating Rest Timer Bar */}
      {timer && timerRemainingSec > 0 && (
        <div className="floating-timer">
          <div className="timer-track">
            <div className="timer-fill" style={{ width: `${timerPct}%` }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="tabular" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
              {formatDuration(timerRemainingSec * 1000)}
            </div>
            <div className="row-sub" style={{ fontSize: 12 }}>
              {timer.exerciseName}
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
        </div>
      )}

      {/* Add Exercise Picker */}
      {addExerciseOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddExerciseOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">Add Exercise</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setAddExerciseOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="search-wrap">
                <Search size={16} />
                <input
                  type="text"
                  autoFocus
                  className="search-input"
                  placeholder="Search exercises"
                  value={exQuery}
                  onChange={(e) => setExQuery(e.target.value)}
                />
              </div>

              <div className="list-group">
                {filteredExercises.map((ex) => {
                  const hasFlag = client.injuries.some((inj) =>
                    ex.bodyRegions.includes(inj.region)
                  );
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      className="list-row interactive"
                      onClick={() => void addExerciseToWorkout(ex.id)}
                    >
                      <div className="list-row-body">
                        <div className="row" style={{ gap: 6 }}>
                          <span className="row-title">{ex.name}</span>
                          {hasFlag && <span className="status-dot danger" />}
                        </div>
                        <span className="row-sub">
                          {ex.equipment} · {ex.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
                        </span>
                      </div>
                      <Plus size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Parallel Client */}
      {parallelPickerOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setParallelPickerOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">Add Parallel Client</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setParallelPickerOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="list-group">
                {clients
                  .filter((c) => !activeWorkouts.some((aw) => aw.clientId === c.id))
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="list-row interactive"
                      onClick={() => {
                        setParallelPickerOpen(false);
                        void startEmptyWorkout(c.id);
                      }}
                    >
                      <span className="monogram">{c.avatarInitials}</span>
                      <div className="list-row-body">
                        <span className="row-title">{c.name}</span>
                      </div>
                      <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
                        Start
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
