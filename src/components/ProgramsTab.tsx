import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  MoreHorizontal,
  Play,
  Plus,
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
    pushToast,
  } = useApp();

  const [mode, setMode] = useState<'routines' | 'programs'>('routines');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [openMenuRoutineId, setOpenMenuRoutineId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [rName, setRName] = useState('');
  const [rFolderId, setRFolderId] = useState('');
  const [rExercises, setRExercises] = useState<RoutineExercise[]>([]);
  const [pickExId, setPickExId] = useState('');
  const [pickProgMode, setPickProgMode] = useState<ProgressionMode>('double_progression');

  const [programModalOpen, setProgramModalOpen] = useState(false);
  const [pName, setPName] = useState('');
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
    pushToast(`Created folder ${trimmed}`);
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
        ? { mode: 'tm_amrap' as const, trainingMaxKg: 100, baseIncrementKg: 2.5, weekIndex: 1 }
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
      pushToast('Add a name and at least one exercise.', 'danger');
      return;
    }
    await db.routines.put({
      id: generateId('routine'),
      folderId: rFolderId || folders[0]?.id || null,
      name: rName.trim(),
      isTemplate: true,
      exercises: rExercises,
      updatedAt: Date.now(),
      deletedAt: null,
    });
    setRName('');
    setRExercises([]);
    setRoutineModalOpen(false);
    pushToast('Saved routine.');
  };

  const duplicateRoutine = async (r: Routine) => {
    await db.routines.put({
      ...r,
      id: generateId('routine'),
      name: `${r.name} (Copy)`,
      updatedAt: Date.now(),
    });
    pushToast('Duplicated routine.');
  };

  const deleteRoutine = async (r: Routine) => {
    const now = Date.now();
    await db.routines.put({ ...r, deletedAt: now, updatedAt: now });
    pushToast(`Deleted ${r.name}`);
  };

  const assignProgram = async (prog: Program) => {
    if (!activeClient || activeEnrollmentByProgram.has(prog.id)) return;
    const now = Date.now();
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
    pushToast(`Assigned to ${activeClient.name.split(' ')[0]}`);
  };

  const saveNewProgram = async () => {
    if (!pName.trim()) {
      pushToast('Enter a program name.', 'danger');
      return;
    }
    await db.programs.put({
      id: generateId('prog'),
      name: pName.trim(),
      description: '',
      weeksCount: Math.max(2, parseInt(pWeeks, 10) || 8),
      deloadEveryNWeeks: Math.max(0, parseInt(pDeload, 10) || 7),
      isMasterTemplate: true,
      days: [
        {
          id: generateId('pday'),
          name: 'Day 1',
          exercises: routines[0]?.exercises.slice(0, 4) ?? [],
        },
      ],
      updatedAt: Date.now(),
      deletedAt: null,
    });
    setPName('');
    setProgramModalOpen(false);
    pushToast('Created program.');
  };

  if (!activeClient) return null;

  return (
    <div className="screen-section">
      <div className="screen-head">
        <h1 className="screen-title">Programs</h1>
        <div className="row" style={{ gap: 2 }}>
          {mode === 'routines' && (
            <button
              type="button"
              className="nav-icon-btn"
              onClick={() => setCreatingFolder((v) => !v)}
              aria-label="New folder"
              title="New Folder"
            >
              <FolderPlus size={19} />
            </button>
          )}
          <button
            id="create-routine-btn"
            type="button"
            className="nav-icon-btn accent"
            onClick={() =>
              mode === 'routines' ? setRoutineModalOpen(true) : setProgramModalOpen(true)
            }
            aria-label={mode === 'routines' ? 'New Routine' : 'New Program'}
          >
            <Plus size={22} />
          </button>
        </div>
      </div>

      <div className="segmented">
        <button
          id="tab-my-routines"
          type="button"
          className={mode === 'routines' ? 'active' : ''}
          onClick={() => setMode('routines')}
        >
          Routines
        </button>
        <button
          id="tab-structured-programs"
          type="button"
          className={mode === 'programs' ? 'active' : ''}
          onClick={() => setMode('programs')}
        >
          Programs
        </button>
      </div>

      {mode === 'routines' ? (
        <>
          {creatingFolder && (
            <div className="row">
              <input
                type="text"
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                style={{ flex: 1, minHeight: 44, padding: '0 12px' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void createFolder()}
              >
                Add
              </button>
            </div>
          )}

          {folders.map((folder) => {
            const items = routines.filter((r) => r.folderId === folder.id);
            const isCollapsed = Boolean(collapsedFolders[folder.id]);
            return (
              <div key={folder.id} className="section-block">
                <button
                  type="button"
                  className="section-header"
                  onClick={() =>
                    setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !isCollapsed }))
                  }
                >
                  <span className="row" style={{ gap: 5 }}>
                    {isCollapsed ? (
                      <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                    ) : (
                      <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                    )}
                    <span className="section-label">{folder.name}</span>
                  </span>
                  <span className="row-sub tabular">{items.length}</span>
                </button>

                {!isCollapsed && (
                  <div className="list-group">
                    {items.length === 0 ? (
                      <div className="empty-state">Empty folder</div>
                    ) : (
                      items.map((r) => {
                        const menuOpen = openMenuRoutineId === r.id;
                        return (
                          <div
                            key={r.id}
                            className="list-row"
                            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                          >
                            <div className="row-between">
                              <div className="list-row-body">
                                <span className="row-title">{r.name}</span>
                                <span className="row-sub">
                                  {r.exercises
                                    .map((e) => exerciseMap.get(e.exerciseId)?.name ?? e.exerciseId)
                                    .join(', ')}
                                </span>
                              </div>
                              <div className="row" style={{ gap: 2 }}>
                                <button
                                  type="button"
                                  className="nav-icon-btn"
                                  onClick={() =>
                                    setOpenMenuRoutineId(menuOpen ? null : r.id)
                                  }
                                  aria-label="Routine options"
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-tinted btn-sm"
                                  onClick={() => void startFromRoutine(r, activeClient.id)}
                                >
                                  Start
                                </button>
                              </div>
                            </div>

                            {menuOpen && (
                              <div
                                className="row"
                                style={{
                                  paddingTop: 6,
                                  borderTop: '1px solid var(--border-hairline)',
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ flex: 1 }}
                                  onClick={() => {
                                    setOpenMenuRoutineId(null);
                                    void duplicateRoutine(r);
                                  }}
                                >
                                  <Copy size={14} /> Duplicate
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger-text btn-sm"
                                  style={{ flex: 1 }}
                                  onClick={() => {
                                    setOpenMenuRoutineId(null);
                                    void deleteRoutine(r);
                                  }}
                                >
                                  <Trash2 size={14} /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          {programs.map((prog) => {
            const enr = activeEnrollmentByProgram.get(prog.id);
            const totalDays = prog.weeksCount * prog.days.length;
            const pct = enr
              ? Math.min(100, Math.round((enr.completedDays / Math.max(1, totalDays)) * 100))
              : 0;

            return (
              <div key={prog.id} className="section-block">
                <div className="section-header">
                  <span className="section-label">{prog.name}</span>
                  {enr ? (
                    <span className="row-sub tabular">
                      Wk {enr.currentWeek}/{prog.weeksCount}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-text"
                      style={{ minHeight: 28, fontSize: 13 }}
                      onClick={() => void assignProgram(prog)}
                    >
                      Assign
                    </button>
                  )}
                </div>

                {enr && (
                  <div className="thin-progress" style={{ marginBottom: 4 }}>
                    <div style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                )}

                <div className="list-group">
                  {prog.days.map((day, dIdx) => {
                    const isNext = enr && enr.currentDayIndex % prog.days.length === dIdx;
                    return (
                      <button
                        key={day.id}
                        type="button"
                        className="list-row interactive"
                        onClick={async () => {
                          let enrId = enr?.id;
                          if (!enrId) {
                            await assignProgram(prog);
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
                        <div className="list-row-body">
                          <div className="row" style={{ gap: 6 }}>
                            <span className="row-title">{day.name}</span>
                            {isNext && <span className="status-dot accent" />}
                          </div>
                          <span className="row-sub">
                            {day.exercises
                              .map((e) => exerciseMap.get(e.exerciseId)?.name ?? e.exerciseId)
                              .join(', ')}
                          </span>
                        </div>
                        <Play
                          size={16}
                          style={{
                            color: isNext ? 'var(--accent)' : 'var(--text-tertiary)',
                            flexShrink: 0,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* New Routine Sheet */}
      {routineModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRoutineModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">New Routine</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setRoutineModalOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Push A"
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                />
              </div>

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

              <div className="section-block">
                <span className="section-label">Exercises</span>
                <div className="field-row">
                  <select
                    value={pickExId || exercises[0]?.id || ''}
                    onChange={(e) => setPickExId(e.target.value)}
                    style={{ minHeight: 44, padding: '0 10px' }}
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
                    style={{ minHeight: 44, padding: '0 10px' }}
                  >
                    <option value="double_progression">Double Prog</option>
                    <option value="tm_amrap">TM + AMRAP</option>
                    <option value="gzclp">GZCLP</option>
                    <option value="rpe_autoreg">RPE Autoreg</option>
                    <option value="none">Manual</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={addExerciseToRoutineDraft}
                >
                  <Plus size={16} /> Add Exercise
                </button>
              </div>

              {rExercises.length > 0 && (
                <div className="list-group">
                  {rExercises.map((re, idx) => (
                    <div key={re.id} className="list-row">
                      <div className="list-row-body">
                        <span className="row-title">
                          {idx + 1}. {exerciseMap.get(re.exerciseId)?.name}
                        </span>
                        <span className="row-sub tabular">
                          {re.defaultSets}×{re.defaultReps}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="nav-icon-btn danger"
                        onClick={() =>
                          setRExercises((prev) => prev.filter((x) => x.id !== re.id))
                        }
                      >
                        <Trash2 size={16} />
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
                Save Routine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Program Sheet */}
      {programModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProgramModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">New Program</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setProgramModalOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Program Name</label>
                <input
                  type="text"
                  placeholder="8-Week Strength Block"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Weeks</label>
                  <input
                    type="number"
                    className="tabular"
                    value={pWeeks}
                    onChange={(e) => setPWeeks(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Deload Every N Wks</label>
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
                onClick={() => void saveNewProgram()}
              >
                Create Program
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
