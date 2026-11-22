import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, generateId } from '../db/database';
import { calculateHybridE1RM } from '../engine/formulas';
import { initTrainingMax } from '../engine/progression';
import {
  BODY_REGION_LABELS,
  MUSCLE_LABELS,
  formatWeight,
  type EquipmentType,
  type Exercise,
  type MuscleGroup,
  type ProgressionConfig,
  type ProgressionMode,
} from '../types/models';
import { MuscleHeatmapSvg } from './MuscleHeatmapSvg';

const EQUIPMENT_LIST: EquipmentType[] = [
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Bodyweight',
  'Kettlebell',
  'Smith Machine',
  'EZ Bar',
  'Trap Bar',
];

export function ExercisesTab() {
  const { exercises, activeClient, pushToast } = useApp();
  const [query, setQuery] = useState('');
  const [equipFilter, setEquipFilter] = useState('all');
  const [muscleFilter, setMuscleFilter] = useState('all');
  const [selectedEx, setSelectedEx] = useState<Exercise | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'history' | 'records' | 'instructions'>(
    'overview'
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cEquip, setCEquip] = useState<EquipmentType>('Dumbbell');
  const [cPrimary, setCPrimary] = useState<MuscleGroup>('chest');
  const [cSecondary, setCSecondary] = useState<MuscleGroup | ''>('');
  const [cInstructions, setCInstructions] = useState('');

  const [setupCueDraft, setSetupCueDraft] = useState('');
  const [progModeDraft, setProgModeDraft] = useState<ProgressionMode>('none');
  const [tmInput, setTmInput] = useState('100');
  const [dpMin, setDpMin] = useState('8');
  const [dpMax, setDpMax] = useState('12');
  const [dpInc, setDpInc] = useState('2.5');
  const [gzWeight, setGzWeight] = useState('80');
  const [rpeTarget, setRpeTarget] = useState('8');

  const clientWorkouts =
    useLiveQuery(
      () =>
        activeClient
          ? db.workouts
              .where('clientId')
              .equals(activeClient.id)
              .filter((w) => !w.deletedAt && w.status === 'completed')
              .toArray()
          : [],
      [activeClient?.id]
    ) ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (equipFilter !== 'all' && e.equipment !== equipFilter) return false;
      if (
        muscleFilter !== 'all' &&
        !e.primaryMuscles.includes(muscleFilter as MuscleGroup) &&
        !e.secondaryMuscles.includes(muscleFilter as MuscleGroup)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q) ||
        e.primaryMuscles.some((m) => MUSCLE_LABELS[m].toLowerCase().includes(q))
      );
    });
  }, [exercises, query, equipFilter, muscleFilter]);

  const openExerciseDetail = async (ex: Exercise) => {
    setSelectedEx(ex);
    setDetailTab('overview');
    if (activeClient) {
      const note = await db.clientExerciseNotes.get(`${activeClient.id}:${ex.id}`);
      setSetupCueDraft(note?.setupCue ?? '');
      const cfg = note?.progressionConfig ?? { mode: 'none' };
      setProgModeDraft(cfg.mode);
      if (cfg.mode === 'tm_amrap') setTmInput(String(cfg.trainingMaxKg));
      if (cfg.mode === 'double_progression') {
        setDpMin(String(cfg.minReps));
        setDpMax(String(cfg.maxReps));
        setDpInc(String(cfg.weightIncrementKg));
      }
      if (cfg.mode === 'gzclp') setGzWeight(String(cfg.currentWeightKg));
      if (cfg.mode === 'rpe_autoreg') setRpeTarget(String(cfg.targetRpe));
    }
  };

  const saveClientExerciseConfig = async () => {
    if (!activeClient || !selectedEx) return;
    let progressionConfig: ProgressionConfig = { mode: 'none' };
    if (progModeDraft === 'double_progression') {
      progressionConfig = {
        mode: 'double_progression',
        minReps: parseInt(dpMin, 10) || 8,
        maxReps: parseInt(dpMax, 10) || 12,
        targetSets: 3,
        weightIncrementKg: parseFloat(dpInc) || 2.5,
        rpeCap: 8.5,
      };
    } else if (progModeDraft === 'tm_amrap') {
      progressionConfig = {
        mode: 'tm_amrap',
        trainingMaxKg: parseFloat(tmInput) || 100,
        baseIncrementKg: 2.5,
        weekIndex: 1,
      };
    } else if (progModeDraft === 'gzclp') {
      const wt = parseFloat(gzWeight) || 80;
      progressionConfig = {
        mode: 'gzclp',
        stage: 1,
        currentWeightKg: wt,
        peakWeightKg: wt,
        weightIncrementKg: 2.5,
      };
    } else if (progModeDraft === 'rpe_autoreg') {
      progressionConfig = {
        mode: 'rpe_autoreg',
        targetRpe: parseFloat(rpeTarget) || 8,
        targetReps: 8,
        deloadEveryNWeeks: 7,
        currentWeek: 1,
      };
    }

    await db.clientExerciseNotes.put({
      id: `${activeClient.id}:${selectedEx.id}`,
      clientId: activeClient.id,
      exerciseId: selectedEx.id,
      setupCue: setupCueDraft.trim(),
      progressionConfig,
      updatedAt: Date.now(),
      deletedAt: null,
    });
    pushToast('Saved exercise settings.');
  };

  const createCustomExercise = async () => {
    if (!cName.trim()) {
      pushToast('Enter an exercise name.', 'danger');
      return;
    }
    const ex: Exercise = {
      id: generateId('ex-custom'),
      name: cName.trim(),
      equipment: cEquip,
      movementPattern: 'isolation',
      primaryMuscles: [cPrimary],
      secondaryMuscles: cSecondary ? [cSecondary] : [],
      bodyRegions: [],
      instructions: cInstructions
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      isCustom: true,
      updatedAt: Date.now(),
      deletedAt: null,
    };
    await db.exercises.put(ex);
    setCName('');
    setCInstructions('');
    setCreateOpen(false);
    pushToast(`Added ${ex.name}`);
  };

  const exHistory = useMemo(() => {
    if (!selectedEx) return [];
    const items: Array<{
      dateMs: number;
      workoutName: string;
      sets: Array<{ weightKg: number; reps: number; rpe?: number | null; e1rmKg: number }>;
    }> = [];
    const sorted = [...clientWorkouts].sort(
      (a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)
    );
    for (const w of sorted) {
      const match = w.exercises.find((e) => e.exerciseId === selectedEx.id);
      if (!match) continue;
      const sets = match.sets
        .filter((s) => s.completed && s.type !== 'W' && (s.reps ?? 0) > 0)
        .map((s) => ({
          weightKg: s.weightKg ?? 0,
          reps: s.reps ?? 0,
          rpe: s.rpe,
          e1rmKg: calculateHybridE1RM(s.weightKg ?? 0, s.reps ?? 0),
        }));
      if (sets.length > 0) {
        items.push({ dateMs: w.finishedAt ?? w.startedAt, workoutName: w.name, sets });
      }
    }
    return items;
  }, [selectedEx, clientWorkouts]);

  const allScatterSets = useMemo(
    () => exHistory.flatMap((h) => h.sets).filter((s) => s.weightKg > 0),
    [exHistory]
  );

  const records = useMemo(() => {
    if (allScatterSets.length === 0) return null;
    return {
      maxWeight: Math.max(...allScatterSets.map((s) => s.weightKg)),
      maxE1rm: Math.max(...allScatterSets.map((s) => s.e1rmKg)),
    };
  }, [allScatterSets]);

  return (
    <div className="screen-section">
      <div className="screen-head">
        <h1 className="screen-title">Exercises</h1>
        <button
          id="create-custom-exercise-btn"
          type="button"
          className="nav-icon-btn accent"
          onClick={() => setCreateOpen(true)}
          aria-label="New custom exercise"
        >
          <Plus size={22} />
        </button>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <div className="search-wrap">
          <Search size={16} />
          <input
            type="text"
            className="search-input"
            placeholder="Search exercises"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="field-row">
          <select
            value={equipFilter}
            onChange={(e) => setEquipFilter(e.target.value)}
            style={{ minHeight: 40, padding: '0 10px', fontSize: 13.5 }}
          >
            <option value="all">All Equipment</option>
            {EQUIPMENT_LIST.map((eq) => (
              <option key={eq} value={eq}>
                {eq}
              </option>
            ))}
          </select>

          <select
            value={muscleFilter}
            onChange={(e) => setMuscleFilter(e.target.value)}
            style={{ minHeight: 40, padding: '0 10px', fontSize: 13.5 }}
          >
            <option value="all">All Muscles</option>
            {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((m) => (
              <option key={m} value={m}>
                {MUSCLE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Unified iOS Grouped List */}
      <div className="list-group">
        {filtered.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="list-row interactive"
            onClick={() => void openExerciseDetail(ex)}
          >
            <div className="list-row-body">
              <span className="row-title">{ex.name}</span>
              <span className="row-sub">
                {ex.equipment} · {ex.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
              </span>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          </button>
        ))}
        {filtered.length === 0 && <div className="empty-state">No matching exercises.</div>}
      </div>

      {/* 4-Sub-Tab Exercise Detail Sheet */}
      {selectedEx && activeClient && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEx(null);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <div style={{ minWidth: 0 }}>
                <h2 className="modal-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedEx.name}
                </h2>
                <div className="row-sub">{selectedEx.equipment}</div>
              </div>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setSelectedEx(null)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="modal-body">
              <div className="segmented">
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'history', label: 'History' },
                    { id: 'records', label: 'Records' },
                    { id: 'instructions', label: 'Cues' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={detailTab === t.id ? 'active' : ''}
                    onClick={() => setDetailTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {detailTab === 'overview' && (
                <div className="col" style={{ gap: 16 }}>
                  <div className="surface-panel">
                    <MuscleHeatmapSvg
                      highlightPrimary={selectedEx.primaryMuscles}
                      highlightSecondary={selectedEx.secondaryMuscles}
                      compact={true}
                    />
                    <div
                      className="row-sub"
                      style={{ textAlign: 'center', marginTop: 10, whiteSpace: 'normal' }}
                    >
                      {selectedEx.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
                      {selectedEx.secondaryMuscles.length > 0 &&
                        ` · Secondary: ${selectedEx.secondaryMuscles
                          .map((m) => MUSCLE_LABELS[m])
                          .join(', ')}`}
                    </div>
                  </div>

                  <div className="field">
                    <label>Setup Cue ({activeClient.name.split(' ')[0]})</label>
                    <input
                      type="text"
                      placeholder="Seat pin, grip, bar position"
                      value={setupCueDraft}
                      onChange={(e) => setSetupCueDraft(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label>Progression Mode</label>
                    <select
                      value={progModeDraft}
                      onChange={(e) => setProgModeDraft(e.target.value as ProgressionMode)}
                    >
                      <option value="none">Manual</option>
                      <option value="double_progression">Double Progression</option>
                      <option value="tm_amrap">TM + AMRAP (5/3/1)</option>
                      <option value="gzclp">GZCLP Cascade</option>
                      <option value="rpe_autoreg">RPE Autoregulation</option>
                    </select>
                  </div>

                  {progModeDraft === 'double_progression' && (
                    <div className="field-row-3">
                      <div className="field">
                        <label>Min Reps</label>
                        <input type="number" value={dpMin} onChange={(e) => setDpMin(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Max Reps</label>
                        <input type="number" value={dpMax} onChange={(e) => setDpMax(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Step kg</label>
                        <input type="number" step="0.5" value={dpInc} onChange={(e) => setDpInc(e.target.value)} />
                      </div>
                    </div>
                  )}

                  {progModeDraft === 'tm_amrap' && (
                    <div className="row" style={{ alignItems: 'flex-end' }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Training Max (kg)</label>
                        <input
                          type="number"
                          step="2.5"
                          className="tabular"
                          value={tmInput}
                          onChange={(e) => setTmInput(e.target.value)}
                        />
                      </div>
                      {records && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setTmInput(String(initTrainingMax(records.maxE1rm)))}
                        >
                          90% ({initTrainingMax(records.maxE1rm)}kg)
                        </button>
                      )}
                    </div>
                  )}

                  {progModeDraft === 'gzclp' && (
                    <div className="field">
                      <label>Stage 1 Weight (5×3, kg)</label>
                      <input
                        type="number"
                        step="2.5"
                        value={gzWeight}
                        onChange={(e) => setGzWeight(e.target.value)}
                      />
                    </div>
                  )}

                  {progModeDraft === 'rpe_autoreg' && (
                    <div className="field">
                      <label>Target RPE</label>
                      <input
                        type="number"
                        step="0.5"
                        min="6"
                        max="10"
                        value={rpeTarget}
                        onChange={(e) => setRpeTarget(e.target.value)}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary btn-full"
                    onClick={() => void saveClientExerciseConfig()}
                  >
                    Save
                  </button>
                </div>
              )}

              {detailTab === 'history' && (
                <div className="list-group">
                  {exHistory.length === 0 ? (
                    <div className="empty-state">No logged sets yet.</div>
                  ) : (
                    exHistory.map((h, i) => (
                      <div
                        key={i}
                        className="list-row"
                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                      >
                        <div className="row-between">
                          <span className="row-title">{h.workoutName}</span>
                          <span className="row-sub tabular">
                            {new Date(h.dateMs).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                        </div>
                        {h.sets.map((s, si) => (
                          <div key={si} className="row-between row-sub tabular">
                            <span>
                              {formatWeight(s.weightKg, activeClient.unit)} {activeClient.unit} ×{' '}
                              {s.reps}
                              {s.rpe ? ` @${s.rpe}` : ''}
                            </span>
                            <span>e1RM {formatWeight(s.e1rmKg, activeClient.unit)}</span>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'records' && (
                <div className="col" style={{ gap: 14 }}>
                  {records ? (
                    <>
                      <div className="metrics-strip">
                        <div className="metric-cell">
                          <span className="metric-label">Best e1RM</span>
                          <span className="metric-value tabular">
                            {formatWeight(records.maxE1rm, activeClient.unit)}
                            <span className="metric-unit">{activeClient.unit}</span>
                          </span>
                        </div>
                        <div className="metric-cell">
                          <span className="metric-label">Heaviest Set</span>
                          <span className="metric-value tabular">
                            {formatWeight(records.maxWeight, activeClient.unit)}
                            <span className="metric-unit">{activeClient.unit}</span>
                          </span>
                        </div>
                      </div>

                      <div className="surface-panel">
                        <span className="section-label">Weight vs Reps</span>
                        {(() => {
                          const maxR = Math.max(12, ...allScatterSets.map((s) => s.reps));
                          const maxW = Math.max(20, ...allScatterSets.map((s) => s.weightKg));
                          return (
                            <svg
                              viewBox="0 0 360 150"
                              style={{ width: '100%', height: 'auto', marginTop: 8 }}
                            >
                              <line x1="36" y1="12" x2="36" y2="124" stroke="rgba(255,255,255,0.08)" />
                              <line x1="36" y1="124" x2="345" y2="124" stroke="rgba(255,255,255,0.08)" />
                              <text x="190" y="144" textAnchor="middle" fill="#636366" fontSize="10">
                                Reps
                              </text>
                              {allScatterSets.map((s, idx) => {
                                const x = 44 + (s.reps / maxR) * 290;
                                const y = 118 - (s.weightKg / maxW) * 98;
                                const isPeak = s.e1rmKg === records.maxE1rm;
                                return (
                                  <circle
                                    key={idx}
                                    cx={x}
                                    cy={y}
                                    r={isPeak ? 5 : 3.5}
                                    fill={isPeak ? '#FFFFFF' : '#007AFF'}
                                    fillOpacity={isPeak ? 1 : 0.7}
                                  />
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">No records yet.</div>
                  )}
                </div>
              )}

              {detailTab === 'instructions' && (
                <div className="col" style={{ gap: 14 }}>
                  <div className="list-group">
                    {selectedEx.instructions.map((step, i) => (
                      <div key={i} className="list-row">
                        <span className="row-sub tabular" style={{ width: 18 }}>
                          {i + 1}.
                        </span>
                        <span style={{ fontSize: 14, flex: 1 }}>{step}</span>
                      </div>
                    ))}
                  </div>
                  {selectedEx.bodyRegions.length > 0 && (
                    <div className="row-sub">
                      Joints: {selectedEx.bodyRegions.map((r) => BODY_REGION_LABELS[r]).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Custom Exercise */}
      {createOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">New Exercise</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setCreateOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Belt Squat"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                />
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label>Equipment</label>
                  <select
                    value={cEquip}
                    onChange={(e) => setCEquip(e.target.value as EquipmentType)}
                  >
                    {EQUIPMENT_LIST.map((eq) => (
                      <option key={eq} value={eq}>
                        {eq}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Primary</label>
                  <select
                    value={cPrimary}
                    onChange={(e) => setCPrimary(e.target.value as MuscleGroup)}
                  >
                    {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((m) => (
                      <option key={m} value={m}>
                        {MUSCLE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Secondary</label>
                  <select
                    value={cSecondary}
                    onChange={(e) => setCSecondary(e.target.value as MuscleGroup | '')}
                  >
                    <option value="">None</option>
                    {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((m) => (
                      <option key={m} value={m}>
                        {MUSCLE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Cues (one per line)</label>
                <textarea
                  rows={3}
                  value={cInstructions}
                  onChange={(e) => setCInstructions(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={() => void createCustomExercise()}
              >
                Add Exercise
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
