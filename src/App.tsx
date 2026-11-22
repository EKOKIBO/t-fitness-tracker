import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Home,
  Play,
  Plus,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { TopCoachBar } from './components/TopCoachBar';
import { ClientSwitcherModal } from './components/ClientSwitcherModal';
import { SettingsModal } from './components/SettingsModal';
import { HomeTab } from './components/HomeTab';
import { ProgramsTab } from './components/ProgramsTab';
import { AnalyticsTab } from './components/AnalyticsTab';
import { ExercisesTab } from './components/ExercisesTab';
import { ActiveWorkoutSheet } from './components/ActiveWorkoutSheet';

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

function AppShell() {
  const {
    ready,
    tab,
    setTab,
    activeClient,
    clients,
    activeWorkouts,
    openWorkoutId,
    setOpenWorkoutId,
    restTimers,
    startEmptyWorkout,
    toasts,
  } = useApp();

  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    if (activeWorkouts.length === 0) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeWorkouts.length]);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 26 }}>
          T<span>!</span>
        </div>
        <span className="card-meta">Initializing local-first vault...</span>
      </div>
    );
  }

  const handleLogTrigger = () => {
    if (activeWorkouts.length > 0) {
      const forCurrent = activeWorkouts.find((w) => w.clientId === activeClient?.id);
      setOpenWorkoutId((forCurrent ?? activeWorkouts[0]).id);
    } else {
      void startEmptyWorkout(activeClient?.id);
    }
  };

  return (
    <div className="app-shell">
      <TopCoachBar />

      <main className="main-viewport">
        {tab === 'home' && <HomeTab />}
        {tab === 'programs' && <ProgramsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'exercises' && <ExercisesTab />}
      </main>

      {/* MINIMIZED PARALLEL ACTIVE SESSIONS DOCK */}
      {!openWorkoutId && activeWorkouts.length > 0 && (
        <div className="active-dock" aria-label="Minimized Active Sessions">
          {activeWorkouts.map((aw) => {
            const c = clients.find((x) => x.id === aw.clientId);
            const timer = restTimers[aw.id];
            const rem = timer ? Math.max(0, Math.ceil((timer.endsAt - tick) / 1000)) : 0;
            return (
              <button
                key={aw.id}
                type="button"
                className="active-session-pill"
                onClick={() => setOpenWorkoutId(aw.id)}
              >
                <div className="row" style={{ minWidth: 0 }}>
                  <span className="live-dot" />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c?.name.split(' ')[0] ?? 'Client'} · {aw.name}
                    </div>
                    <div className="card-meta tabular">
                      {formatElapsed(tick - aw.startedAt)} elapsed
                      {rem > 0 && (
                        <span style={{ color: 'var(--accent-pr)', marginLeft: 8 }}>
                          · Rest {formatElapsed(rem * 1000)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Play size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      {/* 5-TAB BOTTOM NAVIGATION */}
      <nav className="bottom-nav" aria-label="Primary Navigation">
        <div className="bottom-nav-inner">
          <button
            id="nav-home"
            type="button"
            className={`nav-tab ${tab === 'home' ? 'active' : ''}`}
            onClick={() => setTab('home')}
          >
            <Home size={20} />
            <span>Home</span>
          </button>

          <button
            id="nav-programs"
            type="button"
            className={`nav-tab ${tab === 'programs' ? 'active' : ''}`}
            onClick={() => setTab('programs')}
          >
            <ClipboardList size={20} />
            <span>Programs</span>
          </button>

          <div className="nav-tab-log">
            <button
              id="nav-log-fab"
              type="button"
              className="nav-log-fab"
              onClick={handleLogTrigger}
              aria-label="Log Workout"
              title={
                activeWorkouts.length > 0
                  ? 'Resume active workout sheet'
                  : 'Start new workout session'
              }
            >
              {activeWorkouts.length > 0 ? <Play size={22} /> : <Plus size={24} />}
            </button>
          </div>

          <button
            id="nav-analytics"
            type="button"
            className={`nav-tab ${tab === 'analytics' ? 'active' : ''}`}
            onClick={() => setTab('analytics')}
          >
            <BarChart3 size={20} />
            <span>Analytics</span>
          </button>

          <button
            id="nav-exercises"
            type="button"
            className={`nav-tab ${tab === 'exercises' ? 'active' : ''}`}
            onClick={() => setTab('exercises')}
          >
            <BookOpen size={20} />
            <span>Exercises</span>
          </button>
        </div>
      </nav>

      {/* FULL-SCREEN ACTIVE WORKOUT SHEET & FINISH MODAL */}
      <ActiveWorkoutSheet />

      {/* GLOBAL MODALS */}
      <ClientSwitcherModal />
      <SettingsModal />

      {/* TOAST STACK */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-pill ${t.tone}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
