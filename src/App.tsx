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

  const [tick, setTick] = useState(() => Date.now());

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
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: '-0.04em',
        }}
      >
        T<span style={{ color: 'var(--accent)' }}>!</span>
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

      {/* Minimized Active Session(s) Bar */}
      {!openWorkoutId && activeWorkouts.length > 0 && (
        <div className="active-dock" aria-label="Active Sessions">
          {activeWorkouts.map((aw) => {
            const c = clients.find((x) => x.id === aw.clientId);
            const timer = restTimers[aw.id];
            const rem = timer ? Math.max(0, Math.ceil((timer.endsAt - tick) / 1000)) : 0;
            return (
              <button
                key={aw.id}
                type="button"
                className="active-session-bar"
                onClick={() => setOpenWorkoutId(aw.id)}
              >
                <div className="row" style={{ minWidth: 0 }}>
                  <span className="status-dot accent" />
                  <div className="list-row-body">
                    <span className="row-title" style={{ fontSize: 14 }}>
                      {c?.name.split(' ')[0]} · {aw.name}
                    </span>
                    <span className="row-sub tabular" style={{ fontSize: 12 }}>
                      {formatElapsed(tick - aw.startedAt)}
                      {rem > 0 ? ` · Rest ${formatElapsed(rem * 1000)}` : ''}
                    </span>
                  </div>
                </div>
                <Play size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      {/* Flat Native-Style 5-Tab Bottom Bar */}
      <nav className="bottom-nav" aria-label="Primary Navigation">
        <div className="bottom-nav-inner">
          <button
            id="nav-home"
            type="button"
            className={`nav-tab ${tab === 'home' ? 'active' : ''}`}
            onClick={() => setTab('home')}
          >
            <Home size={21} strokeWidth={1.8} />
            <span>Home</span>
          </button>

          <button
            id="nav-programs"
            type="button"
            className={`nav-tab ${tab === 'programs' ? 'active' : ''}`}
            onClick={() => setTab('programs')}
          >
            <ClipboardList size={21} strokeWidth={1.8} />
            <span>Programs</span>
          </button>

          <button
            id="nav-log-fab"
            type="button"
            className="nav-log-btn"
            onClick={handleLogTrigger}
            aria-label="Log Workout"
          >
            {activeWorkouts.length > 0 ? <Play size={20} /> : <Plus size={22} />}
          </button>

          <button
            id="nav-analytics"
            type="button"
            className={`nav-tab ${tab === 'analytics' ? 'active' : ''}`}
            onClick={() => setTab('analytics')}
          >
            <BarChart3 size={21} strokeWidth={1.8} />
            <span>Analytics</span>
          </button>

          <button
            id="nav-exercises"
            type="button"
            className={`nav-tab ${tab === 'exercises' ? 'active' : ''}`}
            onClick={() => setTab('exercises')}
          >
            <BookOpen size={21} strokeWidth={1.8} />
            <span>Exercises</span>
          </button>
        </div>
      </nav>

      <ActiveWorkoutSheet />
      <ClientSwitcherModal />
      <SettingsModal />

      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-pill ${t.tone}`}>
            {t.message}
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
