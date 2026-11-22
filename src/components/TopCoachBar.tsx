import {
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export function TopCoachBar() {
  const {
    activeClient,
    settings,
    setClientSwitcherOpen,
    setSettingsOpen,
    triggerCloudSync,
    triggerEndOfDayBackupExport,
    syncing,
    isOnline,
  } = useApp();

  const unsavedBackups = settings.workoutsSinceLastBackup || 0;

  return (
    <header className="top-coach-bar">
      <div className="row" style={{ minWidth: 0 }}>
        <div className="brand-mark" aria-label="T! Logo">
          T<span>!</span>
        </div>

        <button
          id="client-switcher-trigger"
          type="button"
          className="client-pill"
          onClick={() => setClientSwitcherOpen(true)}
          title="Switch active client profile"
        >
          <span
            className="client-avatar"
            style={{ background: activeClient?.avatarColor ?? '#007AFF' }}
          >
            {activeClient?.avatarInitials ?? 'T!'}
            {activeClient && activeClient.injuries.length > 0 && (
              <span className="injury-dot" title="Active injury flag" />
            )}
          </span>
          <span className="client-pill-name">
            {activeClient?.name ?? 'Select Client'}
          </span>
          <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </button>
      </div>

      <div className="topbar-actions">
        <button
          id="eod-backup-topbar-btn"
          type="button"
          className={`icon-btn ${unsavedBackups > 0 ? 'amber' : ''}`}
          onClick={() => triggerEndOfDayBackupExport(true)}
          title={
            unsavedBackups > 0
              ? `${unsavedBackups} session(s) since last backup — Tap to export Sync File`
              : 'Export End-of-Day Sync Backup (.tfit.json)'
          }
        >
          <Download size={16} />
          {unsavedBackups > 0 && <span className="badge-dot-count tabular">{unsavedBackups}</span>}
        </button>

        <button
          id="cloud-sync-topbar-btn"
          type="button"
          className={`icon-btn ${settings.cloudSyncEnabled && isOnline ? 'accent' : ''}`}
          onClick={() => {
            if (settings.cloudSyncEnabled) {
              void triggerCloudSync(false);
            } else {
              setSettingsOpen(true);
            }
          }}
          title={
            !isOnline
              ? 'Offline (Local-First Active)'
              : settings.cloudSyncEnabled
              ? 'Tap to sync now with Cloudflare D1'
              : 'Local-Only · Tap to configure €0 Cloud Sync'
          }
        >
          {syncing ? (
            <RefreshCw size={16} style={{ animation: 'spin 0.9s linear infinite' }} />
          ) : !isOnline ? (
            <CloudOff size={16} />
          ) : (
            <Cloud size={16} />
          )}
        </button>

        <button
          id="settings-topbar-btn"
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings, Cloud Sync & Backup"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
