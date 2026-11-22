import { ChevronDown, Cloud, CloudOff, RefreshCw, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function TopCoachBar() {
  const {
    activeClient,
    settings,
    setClientSwitcherOpen,
    setSettingsOpen,
    triggerCloudSync,
    syncing,
    isOnline,
  } = useApp();

  const hasUnsavedBackup = (settings.workoutsSinceLastBackup || 0) > 0;

  return (
    <header className="top-nav">
      <button
        id="client-switcher-trigger"
        type="button"
        className="client-switcher-btn"
        onClick={() => setClientSwitcherOpen(true)}
        aria-label="Switch client"
      >
        <span className="monogram">{activeClient?.avatarInitials ?? 'T!'}</span>
        <span className="client-switcher-name">
          {activeClient?.name ?? 'Select Client'}
        </span>
        {activeClient && activeClient.injuries.length > 0 && (
          <span className="status-dot danger" title="Active injury flag" />
        )}
        <ChevronDown size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      </button>

      <div className="row" style={{ gap: 2 }}>
        <button
          id="cloud-sync-topbar-btn"
          type="button"
          className={`nav-icon-btn ${settings.cloudSyncEnabled && isOnline ? 'accent' : ''}`}
          onClick={() => {
            if (settings.cloudSyncEnabled) {
              void triggerCloudSync(false);
            } else {
              setSettingsOpen(true);
            }
          }}
          aria-label="Cloud sync"
          title={
            !isOnline
              ? 'Offline'
              : settings.cloudSyncEnabled
              ? 'Sync with Cloudflare D1'
              : 'Configure Cloud Sync'
          }
        >
          {syncing ? (
            <RefreshCw size={19} style={{ animation: 'spin 0.9s linear infinite' }} />
          ) : !isOnline ? (
            <CloudOff size={19} />
          ) : (
            <Cloud size={19} />
          )}
        </button>

        <button
          id="settings-topbar-btn"
          type="button"
          className="nav-icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings and backups"
          title="Settings & Backups"
        >
          <Settings size={19} />
          {hasUnsavedBackup && <span className="nav-dot-indicator" />}
        </button>
      </div>
    </header>
  );
}
