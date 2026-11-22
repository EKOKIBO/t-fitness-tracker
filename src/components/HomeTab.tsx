import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  Download,
  Image as ImageIcon,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db } from '../db/database';
import { computeCompositeStrengthScore, computeMuscleVolume } from '../engine/formulas';
import { formatWeight, type MuscleGroup } from '../types/models';
import { ProgressCardModal } from './ProgressCardModal';

function formatRelativeDay(ms: number): string {
  const diffDays = Math.floor((Date.now() - ms) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

export function HomeTab() {
  const {
    activeClient,
    clients,
    exerciseMap,
    settings,
    selectClient,
    startEmptyWorkout,
    startFromProgramDay,
    repeatLastWorkout,
    triggerEndOfDayBackupExport,
    setSettingsOpen,
    setTab,
  } = useApp();

  const [viewMode, setViewMode] = useState<'client' | 'roster'>('client');
  const [pngModalClientId, setPngModalClientId] = useState<string | null>(null);
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);

  const allCompletedWorkouts =
    useLiveQuery(
      () =>
        db.workouts
          .where('status')
          .equals('completed')
          .filter((w) => !w.deletedAt)
          .toArray(),
      []
    ) ?? [];

  const enrollments =
    useLiveQuery(
      () =>
        activeClient
          ? db.clientProgramEnrollments
              .where('clientId')
              .equals(activeClient.id)
              .filter((e) => e.active && !e.deletedAt)
              .toArray()
          : [],
      [activeClient?.id]
    ) ?? [];

  const programs =
    useLiveQuery(() => db.programs.filter((p) => !p.deletedAt).toArray(), []) ?? [];

  const clientWorkouts = useMemo(() => {
    if (!activeClient) return [];
    return allCompletedWorkouts
      .filter((w) => w.clientId === activeClient.id)
      .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
  }, [allCompletedWorkouts, activeClient]);

  const sevenDayWorkouts = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    return clientWorkouts.filter((w) => (w.finishedAt ?? w.startedAt) >= cutoff);
  }, [clientWorkouts]);

  const strengthSummary = useMemo(() => {
    if (!activeClient) return null;
    return computeCompositeStrengthScore(activeClient, clientWorkouts, exerciseMap, 90);
  }, [activeClient, clientWorkouts, exerciseMap]);

  const weeklyEffSets = useMemo(() => {
    const mv = computeMuscleVolume(sevenDayWorkouts, exerciseMap);
    const total = (Object.keys(mv) as MuscleGroup[]).reduce(
      (sum, m) => sum + mv[m].effectiveSets,
      0
    );
    return Math.round(total * 10) / 10;
  }, [sevenDayWorkouts, exerciseMap]);

  const activeEnrollment = enrollments[0] ?? null;
  const activeProgram = activeEnrollment
    ? programs.find((p) => p.id === activeEnrollment.programId) ?? null
    : null;
  const nextProgramDay =
    activeProgram && activeEnrollment
      ? activeProgram.days[activeEnrollment.currentDayIndex % activeProgram.days.length]
      : null;

  const rosterRows = useMemo(() => {
    const weekCut = Date.now() - 7 * 86_400_000;
    return clients.map((c) => {
      const wks = allCompletedWorkouts
        .filter((w) => w.clientId === c.id)
        .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
      return {
        client: c,
        lastWorkout: wks[0],
        thisWeek: wks.filter((w) => (w.finishedAt ?? w.startedAt) >= weekCut).length,
      };
    });
  }, [clients, allCompletedWorkouts]);

  const workoutsSinceBackup = settings.workoutsSinceLastBackup || 0;

  if (!activeClient) return null;

  return (
    <div className="screen-section">
      {/* Compact Header & Segmented Switcher */}
      <div className="screen-head">
        <h1 className="screen-title">
          {viewMode === 'client' ? 'Home' : `Roster (${clients.length})`}
        </h1>
        <div className="segmented" style={{ width: 170 }}>
          <button
            type="button"
            className={viewMode === 'client' ? 'active' : ''}
            onClick={() => setViewMode('client')}
          >
            Client
          </button>
          <button
            type="button"
            className={viewMode === 'roster' ? 'active' : ''}
            onClick={() => setViewMode('roster')}
          >
            Roster
          </button>
        </div>
      </div>

      {viewMode === 'roster' ? (
        <div className="section-block">
          <div className="list-group">
            {rosterRows.map(({ client: c, lastWorkout, thisWeek }) => (
              <div key={c.id} className="list-row">
                <div
                  className="row"
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => {
                    void selectClient(c.id);
                    setViewMode('client');
                  }}
                >
                  <span className="monogram lg">{c.avatarInitials}</span>
                  <div className="list-row-body">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="row-title">{c.name}</span>
                      {c.injuries.length > 0 && <span className="status-dot danger" />}
                    </div>
                    <span className="row-sub tabular">
                      {thisWeek}/wk ·{' '}
                      {lastWorkout
                        ? formatRelativeDay(lastWorkout.finishedAt ?? lastWorkout.startedAt)
                        : 'No logs'}
                    </span>
                  </div>
                </div>

                <div className="row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className="nav-icon-btn"
                    onClick={() => setPngModalClientId(c.id)}
                    aria-label={`Progress PNG for ${c.name}`}
                    title="Export Progress PNG"
                  >
                    <ImageIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted btn-sm"
                    onClick={() => {
                      void selectClient(c.id);
                      void startEmptyWorkout(c.id);
                    }}
                  >
                    Log
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Primary Action + Secondary Utility Row */}
          <div className="col" style={{ gap: 10 }}>
            <button
              id="home-start-empty-btn"
              type="button"
              className="btn btn-primary btn-full"
              onClick={() => void startEmptyWorkout(activeClient.id)}
            >
              <Plus size={18} /> Start Workout
            </button>
            <div className="field-row">
              <button
                id="home-repeat-last-btn"
                type="button"
                className="btn btn-secondary"
                onClick={() => void repeatLastWorkout(activeClient.id)}
              >
                <RotateCcw size={15} /> Repeat Last
              </button>
              <button
                id="home-export-png-btn"
                type="button"
                className="btn btn-secondary"
                onClick={() => setPngModalClientId(activeClient.id)}
              >
                <ImageIcon size={15} /> Progress PNG
              </button>
            </div>
          </div>

          {/* Unified 4-Cell Metrics Strip */}
          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Overview</span>
              <button
                type="button"
                className="btn-text"
                style={{ minHeight: 28, fontSize: 13 }}
                onClick={() => setTab('analytics')}
              >
                Analytics
              </button>
            </div>
            <div className="metrics-strip cols-4">
              <div className="metric-cell">
                <span className="metric-label">Strength</span>
                <span className="metric-value tabular">{strengthSummary?.strengthScore ?? 0}</span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">Balance</span>
                <span className="metric-value tabular">
                  {strengthSummary?.balanceIndex ?? 0}
                  <span className="metric-unit">%</span>
                </span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">7d Sessions</span>
                <span className="metric-value tabular">{sevenDayWorkouts.length}</span>
              </div>
              <div className="metric-cell">
                <span className="metric-label">7d Sets</span>
                <span className="metric-value tabular">{weeklyEffSets}</span>
              </div>
            </div>
          </div>

          {/* Active Injury Note (Quiet single hairline list if present) */}
          {activeClient.injuries.length > 0 && (
            <div className="section-block">
              <div className="section-header">
                <span className="section-label">Active Flags</span>
              </div>
              <div className="list-group">
                {activeClient.injuries.map((inj) => (
                  <div key={inj.id} className="list-row">
                    <span className="status-dot danger" />
                    <div className="list-row-body">
                      <span className="row-title">{inj.label}</span>
                      <span className="row-sub">{inj.severity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Up Next in Structured Program */}
          {activeProgram && activeEnrollment && nextProgramDay && (
            <div className="section-block">
              <div className="section-header">
                <span className="section-label">Up Next</span>
                <span className="row-sub tabular">
                  Wk {activeEnrollment.currentWeek}/{activeProgram.weeksCount}
                </span>
              </div>
              <div className="list-group">
                <button
                  type="button"
                  className="list-row interactive"
                  onClick={() =>
                    void startFromProgramDay(
                      activeProgram,
                      nextProgramDay,
                      activeEnrollment.id,
                      activeClient.id
                    )
                  }
                >
                  <div className="list-row-body">
                    <span className="row-title">{nextProgramDay.name}</span>
                    <span className="row-sub">{activeProgram.name}</span>
                  </div>
                  <Play size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                </button>
              </div>
            </div>
          )}

          {/* Recent Completed Workouts (Unified Inset List) */}
          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Recent Workouts</span>
            </div>
            <div className="list-group">
              {clientWorkouts.length === 0 ? (
                <div className="empty-state">No workouts logged yet.</div>
              ) : (
                clientWorkouts.slice(0, 6).map((w) => {
                  const isOpen = expandedWorkoutId === w.id;
                  const dateLabel = new Date(w.finishedAt ?? w.startedAt).toLocaleDateString(
                    'en-GB',
                    { day: 'numeric', month: 'short' }
                  );
                  return (
                    <div
                      key={w.id}
                      className="list-row interactive"
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                      onClick={() => setExpandedWorkoutId(isOpen ? null : w.id)}
                    >
                      <div className="row-between">
                        <div className="list-row-body">
                          <span className="row-title">{w.name}</span>
                          <span className="row-sub tabular">
                            {dateLabel} · {formatWeight(w.totalVolumeKg, activeClient.unit)}{' '}
                            {activeClient.unit}
                            {w.prCount > 0 ? ` · ${w.prCount} PR` : ''}
                          </span>
                        </div>
                        <ChevronRight
                          size={16}
                          style={{
                            color: 'var(--text-tertiary)',
                            transform: isOpen ? 'rotate(90deg)' : 'none',
                            transition: 'transform 140ms ease',
                            flexShrink: 0,
                          }}
                        />
                      </div>

                      {isOpen && (
                        <div
                          className="col"
                          style={{
                            gap: 6,
                            paddingTop: 8,
                            borderTop: '1px solid var(--border-hairline)',
                          }}
                        >
                          {w.exercises.map((we) => (
                            <div key={we.id} style={{ fontSize: 13 }}>
                              <div style={{ fontWeight: 600 }}>
                                {exerciseMap.get(we.exerciseId)?.name ?? we.exerciseId}
                              </div>
                              <div className="row-sub tabular">
                                {we.sets
                                  .filter((s) => s.completed)
                                  .map(
                                    (s) =>
                                      `${s.type !== 'normal' ? `${s.type} ` : ''}${formatWeight(
                                        s.weightKg,
                                        activeClient.unit
                                      )}×${s.reps}${s.rpe ? ` @${s.rpe}` : ''}`
                                  )
                                  .join('  ·  ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Daily Sync File Backup (Clean single inset list, zero fluff) */}
          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Backup</span>
              {workoutsSinceBackup > 0 && (
                <span className="row-sub tabular" style={{ color: 'var(--accent)' }}>
                  {workoutsSinceBackup} unsaved
                </span>
              )}
            </div>
            <div className="list-group">
              <button
                id="home-eod-export-btn"
                type="button"
                className="list-row interactive"
                onClick={() => void triggerEndOfDayBackupExport(true)}
              >
                <div className="list-row-body">
                  <span className="row-title">Export Daily Sync File</span>
                  <span className="row-sub tabular">
                    {settings.lastBackupExportAt > 0
                      ? `Last exported ${new Date(settings.lastBackupExportAt).toLocaleDateString(
                          'en-GB',
                          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
                        )}`
                      : 'Save .tfit.json snapshot to Files'}
                  </span>
                </div>
                <Download size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              </button>
              <button
                type="button"
                className="list-row interactive"
                onClick={() => setSettingsOpen(true)}
              >
                <div className="list-row-body">
                  <span className="row-title">Import Sync File or Cloud Sync</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>
          </div>
        </>
      )}

      {pngModalClientId && (
        <ProgressCardModal
          open={true}
          clientId={pngModalClientId}
          onClose={() => setPngModalClientId(null)}
        />
      )}
    </div>
  );
}
