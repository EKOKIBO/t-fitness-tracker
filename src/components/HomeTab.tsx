import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Award,
  Calendar,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Upload,
  Users,
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

  // Compute roster stats across all clients
  const rosterRows = useMemo(() => {
    const now = Date.now();
    const weekCut = now - 7 * 86_400_000;
    return clients.map((c) => {
      const wks = allCompletedWorkouts
        .filter((w) => w.clientId === c.id)
        .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
      const last = wks[0];
      const thisWeek = wks.filter((w) => (w.finishedAt ?? w.startedAt) >= weekCut).length;
      return { client: c, lastWorkout: last, thisWeek, totalSessions: wks.length };
    });
  }, [clients, allCompletedWorkouts]);

  const workoutsSinceBackup = settings.workoutsSinceLastBackup || 0;
  const todayCount = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return allCompletedWorkouts.filter(
      (w) => (w.finishedAt ?? w.startedAt) >= startOfDay.getTime()
    ).length;
  }, [allCompletedWorkouts]);

  if (!activeClient) return null;

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Header + Client vs Coach Roster switcher */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {viewMode === 'client' ? activeClient.name : `Coach Roster (${clients.length})`}
          </h1>
          <p className="page-subtitle">
            {viewMode === 'client'
              ? activeClient.notes ||
                `${activeClient.sex === 'male' ? 'Male' : 'Female'} · ${activeClient.age}y · ${activeClient.bodyweightKg}kg`
              : `${todayCount} client session(s) logged today across your roster`}
          </p>
        </div>

        <div className="split-pill" style={{ width: 210 }}>
          <button
            type="button"
            className={viewMode === 'client' ? 'active' : ''}
            onClick={() => setViewMode('client')}
          >
            Client View
          </button>
          <button
            type="button"
            className={viewMode === 'roster' ? 'active' : ''}
            onClick={() => setViewMode('roster')}
          >
            All Clients
          </button>
        </div>
      </div>

      {/* END-OF-DAY SYNC BACKUP CARD (Requested daily export / import safety net) */}
      <div
        className="card card-compact row-between"
        style={{
          borderColor:
            workoutsSinceBackup > 0 ? 'rgba(255, 184, 0, 0.42)' : 'var(--border-hairline)',
          background:
            workoutsSinceBackup > 0
              ? 'linear-gradient(135deg, rgba(255, 184, 0, 0.09) 0%, #141417 65%)'
              : undefined,
          flexWrap: 'wrap',
        }}
      >
        <div className="row" style={{ gap: 10, flex: 1, minWidth: 220 }}>
          <div
            className={`icon-btn ${workoutsSinceBackup > 0 ? 'amber' : ''}`}
            style={{ width: 40, height: 40, flexShrink: 0 }}
          >
            <ShieldCheck size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {workoutsSinceBackup > 0
                ? `End-of-Day Sync Backup · ${workoutsSinceBackup} new session${workoutsSinceBackup > 1 ? 's' : ''}`
                : 'Local-First Vault & Daily Sync Backup'}
            </div>
            <div className="card-meta tabular">
              {settings.lastBackupExportAt > 0
                ? `Last file export: ${new Date(settings.lastBackupExportAt).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Export after your last workout of the day for instant recovery if storage is cleared.'}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 6 }}>
          <button
            id="home-eod-export-btn"
            type="button"
            className={`btn btn-sm ${workoutsSinceBackup > 0 ? 'btn-amber' : 'btn-secondary'}`}
            onClick={() => void triggerEndOfDayBackupExport(true)}
          >
            <Download size={14} /> Export Sync File
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSettingsOpen(true)}
            title="Import a saved .tfit.json sync file or configure €0 Cloudflare sync"
          >
            <Upload size={14} /> Import
          </button>
        </div>
      </div>

      {viewMode === 'roster' ? (
        /* === COACH ROSTER PULSE (ALL ~30 CLIENTS) === */
        <div className="col" style={{ gap: 10 }}>
          {rosterRows.map(({ client: c, lastWorkout, thisWeek, totalSessions }) => (
            <div key={c.id} className="card card-compact row-between" style={{ flexWrap: 'wrap' }}>
              <div
                className="row"
                style={{ flex: 1, minWidth: 200, cursor: 'pointer' }}
                onClick={() => {
                  void selectClient(c.id);
                  setViewMode('client');
                }}
              >
                <span className="client-avatar lg" style={{ background: c.avatarColor }}>
                  {c.avatarInitials}
                  {c.injuries.length > 0 && <span className="injury-dot" />}
                </span>
                <div>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 14.5 }}>{c.name}</strong>
                    {c.isPersonal && <span className="chip active">Me</span>}
                    {c.injuries.length > 0 && (
                      <span className="chip danger" style={{ padding: '2px 7px', fontSize: 11 }}>
                        <AlertTriangle size={11} /> {c.injuries.length} flag
                      </span>
                    )}
                  </div>
                  <div className="card-meta tabular">
                    {thisWeek}× this week · {totalSessions} total ·{' '}
                    {lastWorkout
                      ? `Last: ${formatRelativeDay(lastWorkout.finishedAt ?? lastWorkout.startedAt)}`
                      : 'No sessions yet'}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPngModalClientId(c.id)}
                  title="Export client progress PNG"
                >
                  <ImageIcon size={14} /> PNG
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    void selectClient(c.id);
                    void startEmptyWorkout(c.id);
                  }}
                >
                  <Play size={13} /> Log
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* === SINGLE ACTIVE CLIENT DASHBOARD === */
        <>
          {/* Active Injuries Strip if client has any */}
          {activeClient.injuries.length > 0 && (
            <div className="injury-banner" style={{ marginBottom: 0 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>
                <strong>Active Contraindications:</strong>{' '}
                {activeClient.injuries
                  .map((i) => `${i.label} (${i.severity})`)
                  .join(' · ')}
              </span>
            </div>
          )}

          {/* KPI Strip */}
          <div className="kpi-grid cols-4">
            <div className="kpi-tile">
              <span className="section-label">Strength Score</span>
              <span className="kpi-value tabular" style={{ color: 'var(--accent-pr)' }}>
                {strengthSummary?.strengthScore ?? 0}
              </span>
              <span className="kpi-sub">{strengthSummary?.tier ?? 'Beginner'} (DOTS)</span>
            </div>
            <div className="kpi-tile">
              <span className="section-label">Balance Index</span>
              <span className="kpi-value tabular" style={{ color: 'var(--accent-positive)' }}>
                {strengthSummary?.balanceIndex ?? 0}%
              </span>
              <span className="kpi-sub">5-pattern symmetry</span>
            </div>
            <div className="kpi-tile">
              <span className="section-label">7-Day Sessions</span>
              <span className="kpi-value tabular">{sevenDayWorkouts.length}</span>
              <span className="kpi-sub">{clientWorkouts.length} total logged</span>
            </div>
            <div className="kpi-tile">
              <span className="section-label">7-Day Effective</span>
              <span className="kpi-value tabular" style={{ color: 'var(--accent-primary)' }}>
                {weeklyEffSets}
              </span>
              <span className="kpi-sub">RPE-weighted muscle sets</span>
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              id="home-start-empty-btn"
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, minWidth: 150 }}
              onClick={() => void startEmptyWorkout(activeClient.id)}
            >
              <Plus size={16} /> Start Workout
            </button>
            <button
              id="home-repeat-last-btn"
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, minWidth: 150 }}
              onClick={() => void repeatLastWorkout(activeClient.id)}
            >
              <RotateCcw size={15} /> Repeat Last Session
            </button>
            <button
              id="home-export-png-btn"
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, minWidth: 150 }}
              onClick={() => setPngModalClientId(activeClient.id)}
            >
              <ImageIcon size={15} /> Progress PNG Card
            </button>
          </div>

          {/* Next Scheduled Program Day */}
          {activeProgram && activeEnrollment && nextProgramDay && (
            <div className="card">
              <div className="card-header">
                <div>
                  <span className="section-label">Up Next in Structured Program</span>
                  <h2 className="card-title" style={{ marginTop: 3 }}>
                    {activeProgram.name}
                  </h2>
                </div>
                <span className="chip active tabular">
                  Week {activeEnrollment.currentWeek} / {activeProgram.weeksCount}
                </span>
              </div>

              <div
                className="card card-compact row-between"
                style={{ background: 'var(--bg-well)', flexWrap: 'wrap' }}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>{nextProgramDay.name}</strong>
                  <div className="card-meta">
                    {nextProgramDay.exercises
                      .slice(0, 3)
                      .map((e) => exerciseMap.get(e.exerciseId)?.name ?? e.exerciseId)
                      .join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    void startFromProgramDay(
                      activeProgram,
                      nextProgramDay,
                      activeEnrollment.id,
                      activeClient.id
                    )
                  }
                >
                  <Play size={14} /> Launch Day
                </button>
              </div>
            </div>
          )}

          {/* Recent Completed Sessions */}
          <div className="card">
            <div className="card-header">
              <div className="row">
                <Calendar size={16} style={{ color: 'var(--accent-primary)' }} />
                <h2 className="card-title">Recent Sessions · {activeClient.name.split(' ')[0]}</h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setTab('analytics')}
              >
                Strength Lab <ChevronRight size={14} />
              </button>
            </div>

            {clientWorkouts.length === 0 ? (
              <div className="empty-state">
                No completed workouts for {activeClient.name} yet. Tap <strong>Start Workout</strong> or pick a routine in <strong>Programs</strong>.
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {clientWorkouts.slice(0, 6).map((w) => {
                  const isOpen = expandedWorkoutId === w.id;
                  const dateLabel = new Date(w.finishedAt ?? w.startedAt).toLocaleDateString(
                    'en-GB',
                    { weekday: 'short', day: 'numeric', month: 'short' }
                  );
                  return (
                    <div
                      key={w.id}
                      className="card card-compact"
                      style={{ background: 'var(--bg-well)', cursor: 'pointer' }}
                      onClick={() => setExpandedWorkoutId(isOpen ? null : w.id)}
                    >
                      <div className="row-between">
                        <div>
                          <div className="row" style={{ gap: 6 }}>
                            <strong style={{ fontSize: 14 }}>{w.name}</strong>
                            {w.prCount > 0 && (
                              <span className="chip pr tabular" style={{ padding: '2px 7px', fontSize: 11 }}>
                                <Award size={11} /> {w.prCount} PR
                              </span>
                            )}
                          </div>
                          <div className="card-meta tabular">
                            {dateLabel} · {formatWeight(w.totalVolumeKg, activeClient.unit)}{' '}
                            {activeClient.unit} · {w.exercises.length} exercises
                            {w.readiness &&
                              ` · Readiness ${w.readiness.sleep}/${w.readiness.energy}/${w.readiness.soreness}`}
                          </div>
                        </div>
                        <ChevronRight
                          size={15}
                          style={{
                            color: 'var(--text-muted)',
                            transform: isOpen ? 'rotate(90deg)' : 'none',
                            transition: 'transform 140ms ease',
                          }}
                        />
                      </div>

                      {isOpen && (
                        <div className="col" style={{ marginTop: 10, gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-hairline)' }}>
                          {w.exercises.map((we) => (
                            <div key={we.id} style={{ fontSize: 12.5 }}>
                              <div style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                                {exerciseMap.get(we.exerciseId)?.name ?? we.exerciseId}
                              </div>
                              <div className="card-meta tabular">
                                {we.sets
                                  .filter((s) => s.completed)
                                  .map(
                                    (s) =>
                                      `${s.type !== 'normal' ? `[${s.type}] ` : ''}${formatWeight(
                                        s.weightKg,
                                        activeClient.unit
                                      )}×${s.reps}${s.rpe ? `@${s.rpe}` : ''}`
                                  )
                                  .join('  ·  ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick Coach Roster Footer Switch */}
      {viewMode === 'client' && clients.length > 1 && (
        <button
          type="button"
          className="btn btn-secondary btn-full"
          onClick={() => setViewMode('roster')}
        >
          <Users size={15} /> View All {clients.length} Clients Pulse
        </button>
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
