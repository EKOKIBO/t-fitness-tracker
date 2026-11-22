import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, generateId } from '../db/database';
import type {
  ProgressionMode,
  Program,
  Routine,
  RoutineExercise,
} from '../types/models';

export function ProgramsTab() {
  const {
    activeClient,
    exercises,
    exerciseMap,
    startFromRoutine,
    startFromProgramDay,
    repeatLastWorkout,
    pushToast,
  } = useApp();

  const [mode, setMode] = useState<'routines' | 'programs'>('routines');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Routine Creator Modal
  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [rName, setRName] = useState('');
  const [rDesc, setRDesc] = useState('');
  const [rFolderId, setRFolderId] = useState<string>('');
  const [rExercises, setRExercises] = useState<RoutineExercise[]>([]);
  const [pickExId, setPickExId] = useState('');
  const [pickProgMode, setPickProgMode] = useState<ProgressionMode>('double_progression');

  // Master Program Creator Modal
  const [programModalOpen, setProgramModalOpen] = useState(false);
  const [pName, setPName] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pWeeks, setPWeeks] = useState('8');
  const [pDeload, setPDeload] = useState('7');

  const folders =
    useLiveQuery(
      () => db.routineFolders.filter((f) => !f.deletedAt).sortBy('order'),
      []
    ) ?? [];

  const routines =
    useLiveQuery(() => db.routines.filter((r) => !r.deletedAt).toArray(), []) ?? [];

  const programs =
    useLiveQuery(() => db.programs.filter((p) => !p.deletedAt).toArray(), []) ?? [];

  const enrollments =
    useLiveQuery(
      () =>
        activeClient
          ? db.clientProgramEnrollments
              .where('clientId')
              .equals(activeClient.id)
              .filter((e) => !e.deletedAt)
              .toArray()
          : [],
      [activeClient?.id]
    ) ?? [];

  const activeEnrollmentByProgram = useMemo(
    () => new Map(enrollments.filter((e) => e.active).map((e) => [e.programId, e])),
    [enrollments]
  );

  const createFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    await db.routineFolders.put({
      id: generateId('folder'),
      name: trimmed,
      order: folders.length,
      updatedAt: Date.now(),
      deletedAt: null,
    });
    setNewFolderName('');
    setCreatingFolder(false);
    pushToast(`Created folder "${trimmed}"`, 'positive');
  };

  const addExerciseToRoutineDraft = () => {
    const exId = pickExId || exercises[0]?.id;
    if (!exId) return;
    const progConfig =
      pickProgMode === 'double_progression'
        ? {
            mode: 'double_progression' as const,
            minReps: 8,
            maxReps: 12,
            targetSets: 3,
            weightIncrementKg: 2.5,
            rpeCap: 8.5,
          }
        : pickProgMode === 'tm_amrap'
        ? {
            mode: 'tm_amrap' as const,
            trainingMaxKg: 100,
            baseIncrementKg: 2.5,
            weekIndex: 1,
          }
        : pickProgMode === 'gzclp'
        ? {
            mode: 'gzclp' as const,
            stage: 1 as const,
            currentWeightKg: 80,
            peakWeightKg: 80,
            weightIncrementKg: 2.5,
          }
        : pickProgMode === 'rpe_autoreg'
        ? {
            mode: 'rpe_autoreg' as const,
            targetRpe: 8,
            targetReps: 8,
            deloadEveryNWeeks: 7,
            currentWeek: 1,
          }
        : { mode: 'none' as const };

    setRExercises((prev) => [
      ...prev,
      {
        id: generateId('re'),
        exerciseId: exId,
        defaultSets: pickProgMode === 'gzclp' ? 5 : 3,
        defaultReps: pickProgMode === 'gzclp' ? 3 : 10,
        restSeconds: 120,
        progressionConfig: progConfig,
      },
    ]);
  };

  const saveNewRoutine = async () => {
    if (!rName.trim() || rExercises.length === 0) {
      pushToast('Enter a routine name and add at least one exercise.', 'danger');
      return;
    }
    const now = Date.now();
    await db.routines.put({
      id: generateId('routine'),
      folderId: rFolderId || folders[0]?.id || null,
      name: rName.trim(),
      description: rDesc.trim(),
      isTemplate: true,
      exercises: rExercises,
      updatedAt: now,
      deletedAt: null,
    });
    setRName('');
    setRDesc('');
    setRExercises([]);
    setRoutineModalOpen(false);
    pushToast('Saved reusable routine template!', 'positive');
  };

  const duplicateRoutine = async (r: Routine) => {
    const now = Date.now();
    await db.routines.put({
      ...r,
      id: generateId('routine'),
      name: `${r.name} (Copy)`,
      updatedAt: now,
    });
    pushToast('Cloned routine template.', 'positive');
  };

  const deleteRoutine = async (r: Routine) => {
    const now = Date.now();
    await db.routines.put({ ...r, deletedAt: now, updatedAt: now });
    pushToast(`Deleted "${r.name}"`, 'default');
  };

  const assignMasterProgramToClient = async (prog: Program) => {
    if (!activeClient) return;
    const now = Date.now();
    // Deactivate previous enrollments for this program if any, then enroll fresh with isolated client progression
    const existing = activeEnrollmentByProgram.get(prog.id);
    if (existing) {
      pushToast(`${activeClient.name.split(' ')[0]} is already enrolled in this program.`, 'default');
      return;
    }

    // Seed per-client progression configs in clientExerciseNotes for exercises that don't yet have one
    for (const day of prog.days) {
      for (const re of day.exercises) {
        if (!re.progressionConfig || re.progressionConfig.mode === 'none') continue;
        const noteId = `${activeClient.id}:${re.exerciseId}`;
        const cur = await db.clientExerciseNotes.get(noteId);
        if (!cur) {
          await db.clientExerciseNotes.put({
            id: noteId,
            clientId: activeClient.id,
            exerciseId: re.exerciseId,
            setupCue: '',
            progressionConfig: re.progressionConfig,
            updatedAt: now,
            deletedAt: null,
          });
        }
      }
    }

    await db.clientProgramEnrollments.put({
      id: generateId('enr'),
      clientId: activeClient.id,
      programId: prog.id,
      currentWeek: 1,
      currentDayIndex: 0,
      completedDays: 0,
      active: true,
      startedAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    pushToast(
      `Cloned "${prog.name}" to ${activeClient.name} with independent progression!`,
      'positive'
    );
  };

  const saveNewMasterProgram = async () => {
    if (!pName.trim()) {
      pushToast('Please enter a program name.', 'danger');
      return;
    }
    const now = Date.now();
    const firstRoutine = routines[0];
    await db.programs.put({
      id: generateId('prog'),
      name: pName.trim(),
      description: pDesc.trim() || 'Custom multi-week coach program template.',
      weeksCount: Math.max(2, parseInt(pWeeks, 10) || 8),
      deloadEveryNWeeks: Math.max(0, parseInt(pDeload, 10) || 7),
      isMasterTemplate: true,
      days: [
        {
          id: generateId('pday'),
          name: 'Day 1 — Primary Focus',
          exercises: firstRoutine?.exercises.slice(0, 4) ?? [],
        },
      ],
      updatedAt: now,
      deletedAt: null,
    });
    setPName('');
    setPDesc('');
    setProgramModalOpen(false);
    pushToast('Created Master Program template!', 'positive');
  };

  if (!activeClient) return null;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Programs &amp; Routines</h1>
          <p className="page-subtitle">
            Build once as Master Templates — run with independent weights &amp; progression for{' '}
            <strong>{activeClient.name}</strong>
          </p>
        </div>
      </div>

      {/* Split-Pill Switcher */}
      <div className="split-pill">
        <button
          id="tab-my-routines"
          type="button"
          className={mode === 'routines' ? 'active' : ''}
          onClick={() => setMode('routines')}
        >
          My Routines ({routines.length})
        </button>
        <button
          id="tab-structured-programs"
          type="button"
          className={mode === 'programs' ? 'active' : ''}
          onClick={() => setMode('programs')}
        >
          Structured Programs ({programs.length})
        </button>
      </div>

      {mode === 'routines' ? (
        <div className="col" style={{ gap: 14 }}>
          {/* Quick Repeat Last + Actions */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => void repeatLastWorkout(activeClient.id)}
            >
              <RotateCcw size={15} /> Quick Repeat Last Session
            </button>
            <button
              id="create-routine-btn"
              type="button"
              className="btn btn-secondary"
              onClick={() => setRoutineModalOpen(true)}
            >
              <Plus size={15} /> New Routine
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreatingFolder((v) => !v)}
              title="Add folder"
            >
              <FolderPlus size={15} />
            </button>
          </div>

          {creatingFolder && (
            <div className="card card-compact row">
              <input
                type="text"
                placeholder="Folder name (e.g., Rehab, Hypertrophy Splits)..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                style={{ flex: 1, padding: '8px 10px' }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void createFolder()}>
                Create
              </button>
            </div>
          )}

          {/* Collapsible Folders */}
          {folders.map((folder) => {
            const items = routines.filter((r) => r.folderId === folder.id);
            const isCollapsed = Boolean(collapsedFolders[folder.id]);
            return (
              <div key={folder.id} className="col" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="row-between"
                  style={{ padding: '4px 2px', color: 'var(--text-secondary)' }}
                  onClick={() =>
                    setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !isCollapsed }))
                  }
                >
                  <div className="row">
                    {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    <Folder size={15} style={{ color: 'var(--accent-primary)' }} />
                    <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
                      {folder.name}
                    </strong>
                    <span className="card-meta tabular">({items.length})</span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="col" style={{ gap: 8 }}>
                    {items.map((r) => (
                      <div key={r.id} className="card card-compact col" style={{ gap: 8 }}>
                        <div className="row-between">
                          <div>
                            <strong style={{ fontSize: 14.5 }}>{r.name}</strong>
                            {r.description && <p className="card-meta">{r.description}</p>}
                          </div>
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Clone routine"
                              onClick={() => void duplicateRoutine(r)}
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              title="Delete routine"
                              onClick={() => void deleteRoutine(r)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="chip-row">
                          {r.exercises.map((re) => (
                            <span key={re.id} className="chip" style={{ fontSize: 11.5 }}>
                              {exerciseMap.get(re.exerciseId)?.name ?? re.exerciseId} ·{' '}
                              {re.defaultSets}×{re.defaultReps}
                            </span>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-full"
                          onClick={() => void startFromRoutine(r, activeClient.id)}
                        >
                          <Play size={14} /> Start for {activeClient.name.split(' ')[0]}
                        </button>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <div className="card card-compact card-meta">Empty folder.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unfiled Routines */}
          {routines.filter((r) => !r.folderId || !folders.some((f) => f.id === r.folderId)).length >
            0 && (
            <div className="col" style={{ gap: 8 }}>
              <span className="section-label">General Routines</span>
              {routines
                .filter((r) => !r.folderId || !folders.some((f) => f.id === r.folderId))
                .map((r) => (
                  <div key={r.id} className="card card-compact row-between">
                    <div>
                      <strong>{r.name}</strong>
                      <div className="card-meta">{r.exercises.length} exercises</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void startFromRoutine(r, activeClient.id)}
                    >
                      <Play size={14} /> Start
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
        /* === STRUCTURED MULTI-WEEK PROGRAMS === */
        <div className="col" style={{ gap: 14 }}>
          <div className="row-between">
            <span className="section-label">Master Coach Blocks (Per-Client Cloning)</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setProgramModalOpen(true)}
            >
              <Plus size={14} /> New Master Program
            </button>
          </div>

          {programs.map((prog) => {
            const enrollment = activeEnrollmentByProgram.get(prog.id);
            const totalDays = prog.weeksCount * prog.days.length;
            const progressPct = enrollment
              ? Math.min(100, Math.round((enrollment.completedDays / Math.max(1, totalDays)) * 100))
              : 0;

            return (
              <div key={prog.id} className="card col" style={{ gap: 12 }}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <Layers size={15} style={{ color: 'var(--accent-primary)' }} />
                      <strong style={{ fontSize: 16 }}>{prog.name}</strong>
                      {prog.isMasterTemplate && <span className="chip">Master Template</span>}
                    </div>
                    <p className="card-meta" style={{ marginTop: 4 }}>
                      {prog.description}
                    </p>
                  </div>

                  {enrollment ? (
                    <span className="chip positive tabular">
                      <Check size={12} /> Active · Wk {enrollment.currentWeek}/{prog.weeksCount}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void assignMasterProgramToClient(prog)}
                    >
                      Assign to {activeClient.name.split(' ')[0]}
                    </button>
                  )}
                </div>

                {/* Progress Bar if client is enrolled */}
                {enrollment && (
                  <div className="col" style={{ gap: 4 }}>
                    <div className="row-between card-meta tabular">
                      <span>
                        Week {enrollment.currentWeek} of {prog.weeksCount} · Deload every{' '}
                        {prog.deloadEveryNWeeks}th wk
                      </span>
                      <span>
                        {enrollment.completedDays}/{totalDays} sessions ({progressPct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--bg-well)',
                        borderRadius: 99,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(4, progressPct)}%`,
                          height: '100%',
                          background: 'var(--accent-primary)',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Program Days */}
                <div className="col" style={{ gap: 6 }}>
                  {prog.days.map((day, dIdx) => {
                    const isNext =
                      enrollment &&
                      enrollment.currentDayIndex % prog.days.length === dIdx;
                    return (
                      <div
                        key={day.id}
                        className="card card-compact row-between"
                        style={{
                          background: 'var(--bg-well)',
                          borderColor: isNext ? 'rgba(0, 122, 255, 0.45)' : undefined,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <strong style={{ fontSize: 13.5 }}>{day.name}</strong>
                            {isNext && (
                              <span className="chip active" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                                Next Up
                              </span>
                            )}
                          </div>
                          <div className="card-meta">
                            {day.exercises
                              .map((e) => exerciseMap.get(e.exerciseId)?.name ?? e.exerciseId)
                              .join(' · ')}
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`btn btn-sm ${isNext ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={async () => {
                            let enrId = enrollment?.id;
                            if (!enrId) {
                              await assignMasterProgramToClient(prog);
                              const fresh = await db.clientProgramEnrollments
                                .where('clientId')
                                .equals(activeClient.id)
                                .filter((e) => e.programId === prog.id && e.active)
                                .first();
                              enrId = fresh?.id ?? '';
                            }
                            void startFromProgramDay(prog, day, enrId, activeClient.id);
                          }}
                        >
                          <Play size={13} /> Run
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* NEW ROUTINE MODAL */}
      {routineModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRoutineModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="card-title">Create Routine Template</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setRoutineModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Routine Name</label>
                <input
                  type="text"
                  placeholder="e.g., Push B — Hypertrophy Focus"
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Folder</label>
                  <select
                    value={rFolderId || folders[0]?.id || ''}
                    onChange={(e) => setRFolderId(e.target.value)}
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Description</label>
                  <input
                    type="text"
                    placeholder="Optional notes"
                    value={rDesc}
                    onChange={(e) => setRDesc(e.target.value)}
                  />
                </div>
              </div>

              <div className="divider" />

              <span className="section-label">Add Exercises &amp; Progression Mode</span>
              <div className="field-row">
                <select
                  value={pickExId || exercises[0]?.id || ''}
                  onChange={(e) => setPickExId(e.target.value)}
                  style={{ padding: '9px 10px', fontSize: 13 }}
                >
                  {exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <select
                  value={pickProgMode}
                  onChange={(e) => setPickProgMode(e.target.value as ProgressionMode)}
                  style={{ padding: '9px 10px', fontSize: 13 }}
                >
                  <option value="double_progression">Mode A: Double Progression</option>
                  <option value="tm_amrap">Mode B: TM + AMRAP (5/3/1)</option>
                  <option value="gzclp">Mode C: GZCLP Failure-Cascade</option>
                  <option value="rpe_autoreg">Mode D: RPE Autoreg + Deload</option>
                  <option value="none">Manual / No Engine</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addExerciseToRoutineDraft}
              >
                <Plus size={14} /> Append Exercise to Routine
              </button>

              {rExercises.length > 0 && (
                <div className="col" style={{ gap: 6 }}>
                  {rExercises.map((re, idx) => (
                    <div
                      key={re.id}
                      className="card card-compact row-between"
                      style={{ background: 'var(--bg-well)' }}
                    >
                      <div>
                        <strong style={{ fontSize: 13.5 }}>
                          {idx + 1}. {exerciseMap.get(re.exerciseId)?.name}
                        </strong>
                        <div className="card-meta">
                          {re.defaultSets}×{re.defaultReps} · Engine:{' '}
                          {re.progressionConfig?.mode ?? 'none'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() =>
                          setRExercises((prev) => prev.filter((x) => x.id !== re.id))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={() => void saveNewRoutine()}
              >
                Save Routine Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW MASTER PROGRAM MODAL */}
      {programModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProgramModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="card-title">Create Master Program Template</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setProgramModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Program Name</label>
                <input
                  type="text"
                  placeholder="e.g., 8-Week Powerbuilding Mesocycle"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  rows={2}
                  value={pDesc}
                  onChange={(e) => setPDesc(e.target.value)}
                  placeholder="Target audience, progression structure..."
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Duration (Weeks)</label>
                  <input
                    type="number"
                    className="tabular"
                    value={pWeeks}
                    onChange={(e) => setPWeeks(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Auto-Deload Every Nth Week</label>
                  <input
                    type="number"
                    className="tabular"
                    value={pDeload}
                    onChange={(e) => setPDeload(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={() => void saveNewMasterProgram()}
              >
                Save Master Program
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
