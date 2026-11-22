import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Award,
  CheckCircle2,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
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
  const [equipFilter, setEquipFilter] = useState<string>('all');
  const [muscleFilter, setMuscleFilter] = useState<string>('all');
  const [selectedEx, setSelectedEx] = useState<Exercise | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'history' | 'records' | 'instructions'>(
    'overview'
  );

  // Custom Exercise Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cEquip, setCEquip] = useState<EquipmentType>('Dumbbell');
  const [cPrimary, setCPrimary] = useState<MuscleGroup>('chest');
  const [cSecondary, setCSecondary] = useState<MuscleGroup | ''>('');
  const [cInstructions, setCInstructions] = useState('');

  // Client setup note & progression state inside detail modal
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
    pushToast(
      `Saved ${activeClient.name.split(' ')[0]}'s cue & progression engine for ${selectedEx.name}.`,
      'positive'
    );
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
    pushToast(`Added custom exercise "${ex.name}"`, 'positive');
  };

  // History & Scatter Plot data for currently selected exercise
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
    const maxWeight = Math.max(...allScatterSets.map((s) => s.weightKg));
    const maxE1rm = Math.max(...allScatterSets.map((s) => s.e1rmKg));
    const maxVol = Math.max(...allScatterSets.map((s) => s.weightKg * s.reps));
    return { maxWeight, maxE1rm, maxVol };
  }, [allScatterSets]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Exercises ({exercises.length})</h1>
          <p className="page-subtitle">
            Instant movement catalog, per-client cue notes &amp; progression rules
          </p>
        </div>
        <button
          id="create-custom-exercise-btn"
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={14} /> Custom Exercise
        </button>
      </div>

      {/* Fuzzy Search & Filters */}
      <div className="col" style={{ gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            placeholder="Search movement, muscle, or equipment..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: 14 }}
          />
        </div>

        <div className="field-row">
          <select
            value={equipFilter}
            onChange={(e) => setEquipFilter(e.target.value)}
            style={{ padding: '8px 10px', fontSize: 13 }}
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
            style={{ padding: '8px 10px', fontSize: 13 }}
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

      {/* Exercise List */}
      <div className="col" style={{ gap: 8 }}>
        {filtered.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="card card-compact row-between"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => void openExerciseDetail(ex)}
          >
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14.5 }}>{ex.name}</strong>
                {ex.isCanonicalStrengthLift && (
                  <span className="chip pr" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                    DOTS Lift
                  </span>
                )}
                {ex.isCustom && (
                  <span className="chip active" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                    Custom
                  </span>
                )}
              </div>
              <div className="card-meta">
                {ex.equipment} ·{' '}
                {ex.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
                {ex.secondaryMuscles.length > 0 &&
                  ` (+ ${ex.secondaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')})`}
              </div>
            </div>
            <SlidersHorizontal size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">No exercises matched your filters.</div>
        )}
      </div>

      {/* 4-SUB-TAB EXERCISE DETAIL SHEET */}
      {selectedEx && activeClient && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEx(null);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <div>
                <h2 className="card-title">{selectedEx.name}</h2>
                <p className="card-meta">
                  {selectedEx.equipment} · Context: {activeClient.name}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedEx(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="split-pill">
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
                <div className="col" style={{ gap: 12 }}>
                  <div className="card card-compact" style={{ background: '#0e0e12' }}>
                    <MuscleHeatmapSvg
                      highlightPrimary={selectedEx.primaryMuscles}
                      highlightSecondary={selectedEx.secondaryMuscles}
                      compact={true}
                    />
                    <div className="chip-row" style={{ justifyContent: 'center', marginTop: 8 }}>
                      {selectedEx.primaryMuscles.map((m) => (
                        <span key={m} className="chip active">
                          Primary: {MUSCLE_LABELS[m]}
                        </span>
                      ))}
                      {selectedEx.secondaryMuscles.map((m) => (
                        <span key={m} className="chip">
                          Secondary: {MUSCLE_LABELS[m]}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Per-Client Sticky Equipment Setup Note */}
                  <div className="field">
                    <label className="row" style={{ gap: 5 }}>
                      <Pin size={12} style={{ color: 'var(--accent-pr)' }} />
                      Pinned Equipment &amp; Cue Note for {activeClient.name.split(' ')[0]}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Pin #4 · Belt hole #3 · Neutral grip"
                      value={setupCueDraft}
                      onChange={(e) => setSetupCueDraft(e.target.value)}
                    />
                  </div>

                  {/* Per-Client Algorithmic Progression Assignment */}
                  <div className="field">
                    <label>Progression Algorithm ({activeClient.name.split(' ')[0]})</label>
                    <select
                      value={progModeDraft}
                      onChange={(e) => setProgModeDraft(e.target.value as ProgressionMode)}
                    >
                      <option value="none">Manual Logging (No Auto-Engine)</option>
                      <option value="double_progression">Mode A: Deterministic Double Progression</option>
                      <option value="tm_amrap">Mode B: Training Max (TM) + AMRAP 5/3/1</option>
                      <option value="gzclp">Mode C: GZCLP Linear Failure-Cascade</option>
                      <option value="rpe_autoreg">Mode D: RPE / RIR Autoregulation + Deloads</option>
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
                        <label>Step +kg</label>
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
                          className="btn btn-secondary btn-sm"
                          onClick={() => setTmInput(String(initTrainingMax(records.maxE1rm)))}
                        >
                          90% of e1RM ({initTrainingMax(records.maxE1rm)}kg)
                        </button>
                      )}
                    </div>
                  )}

                  {progModeDraft === 'gzclp' && (
                    <div className="field">
                      <label>Starting Stage 1 Weight (5×3, kg)</label>
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
                      <label>Target RPE (Auto-scales next set ±3.5% per RPE)</label>
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
                    Save Client Settings for This Lift
                  </button>
                </div>
              )}

              {detailTab === 'history' && (
                <div className="col" style={{ gap: 8 }}>
                  {exHistory.length === 0 ? (
                    <div className="empty-state">
                      No logged history for {selectedEx.name} ({activeClient.name}).
                    </div>
                  ) : (
                    exHistory.map((h, i) => (
                      <div key={i} className="card card-compact" style={{ background: 'var(--bg-well)' }}>
                        <div className="row-between">
                          <strong style={{ fontSize: 13.5 }}>{h.workoutName}</strong>
                          <span className="card-meta tabular">
                            {new Date(h.dateMs).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <div className="col" style={{ gap: 3, marginTop: 6 }}>
                          {h.sets.map((s, si) => (
                            <div key={si} className="row-between card-meta tabular">
                              <span>
                                Set {si + 1}:{' '}
                                <strong style={{ color: 'var(--text-primary)' }}>
                                  {formatWeight(s.weightKg, activeClient.unit)} {activeClient.unit} ×{' '}
                                  {s.reps}
                                </strong>
                                {s.rpe ? ` @ RPE ${s.rpe}` : ''}
                              </span>
                              <span>e1RM {formatWeight(s.e1rmKg, activeClient.unit)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'records' && (
                <div className="col" style={{ gap: 12 }}>
                  {records ? (
                    <>
                      <div className="kpi-grid">
                        <div className="kpi-tile">
                          <span className="section-label">Best Hybrid e1RM</span>
                          <span className="kpi-value tabular" style={{ color: 'var(--accent-pr)' }}>
                            {formatWeight(records.maxE1rm, activeClient.unit)} {activeClient.unit}
                          </span>
                        </div>
                        <div className="kpi-tile">
                          <span className="section-label">Heaviest Set</span>
                          <span className="kpi-value tabular" style={{ color: 'var(--accent-primary)' }}>
                            {formatWeight(records.maxWeight, activeClient.unit)} {activeClient.unit}
                          </span>
                        </div>
                      </div>

                      {/* Weight vs Reps Scatter Plot */}
                      <div className="card card-compact" style={{ background: '#0e0e12' }}>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <Award size={14} style={{ color: 'var(--accent-pr)' }} />
                          <span className="section-label">Weight × Reps Scatter Plot</span>
                        </div>
                        {(() => {
                          const maxR = Math.max(12, ...allScatterSets.map((s) => s.reps));
                          const maxW = Math.max(20, ...allScatterSets.map((s) => s.weightKg));
                          return (
                            <svg viewBox="0 0 360 150" style={{ width: '100%', height: 'auto' }}>
                              <line x1="36" y1="12" x2="36" y2="124" stroke="#242429" />
                              <line x1="36" y1="124" x2="345" y2="124" stroke="#242429" />
                              <text x="190" y="144" textAnchor="middle" fill="#71717A" fontSize="10">
                                Reps
                              </text>
                              <text x="12" y="70" fill="#71717A" fontSize="10">
                                {activeClient.unit}
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
                                    r={isPeak ? 5.5 : 3.8}
                                    fill={isPeak ? '#FFB800' : '#007AFF'}
                                    fillOpacity={isPeak ? 1 : 0.72}
                                  />
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">Log sets to compute PRs and scatter plots.</div>
                  )}
                </div>
              )}

              {detailTab === 'instructions' && (
                <div className="col" style={{ gap: 10 }}>
                  {selectedEx.instructions.map((step, i) => (
                    <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
                      <CheckCircle2
                        size={16}
                        style={{ color: 'var(--accent-positive)', marginTop: 2, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{step}</span>
                    </div>
                  ))}
                  {selectedEx.bodyRegions.length > 0 && (
                    <div className="col" style={{ marginTop: 6 }}>
                      <span className="section-label">Joints Loaded (Injury Cross-Check)</span>
                      <div className="chip-row">
                        {selectedEx.bodyRegions.map((r) => (
                          <span key={r} className="chip">
                            {BODY_REGION_LABELS[r]}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE CUSTOM EXERCISE MODAL */}
      {createOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="card-title">Create Custom Exercise</h2>
              <button type="button" className="icon-btn" onClick={() => setCreateOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Exercise Name</label>
                <input
                  type="text"
                  placeholder="e.g., Belt Squat Machine"
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
                  <label>Primary Muscle</label>
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
                <label>Coaching Cues (1 per line)</label>
                <textarea
                  rows={3}
                  placeholder="Brace core&#10;Control 2s eccentric"
                  value={cInstructions}
                  onChange={(e) => setCInstructions(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={() => void createCustomExercise()}
              >
                Add to Catalog
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
