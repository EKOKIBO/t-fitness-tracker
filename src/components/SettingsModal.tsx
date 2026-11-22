import { useState } from 'react';
import { ChevronRight, Download, RefreshCw, Upload, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  clearDemoClientsKeepPersonal,
  db,
  restoreFromBackupSnapshot,
} from '../db/database';
import { checkCloudSyncHealth } from '../db/syncClient';
import {
  downloadOrShareFile,
  exportWorkoutsToCsv,
  importExternalWorkoutsCsv,
  validateBackupSnapshot,
  type TFitBackupSnapshot,
} from '../engine/portability';

const ALL_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

export function SettingsModal() {
  const {
    isSettingsOpen,
    setSettingsOpen,
    settings,
    updateAppSettings,
    clients,
    activeClient,
    exercises,
    exerciseMap,
    triggerCloudSync,
    triggerEndOfDayBackupExport,
    syncing,
    pushToast,
  } = useApp();

  const [syncUrl, setSyncUrl] = useState(settings.cloudSyncUrl || '/api/sync');
  const [syncKey, setSyncKey] = useState(settings.cloudSyncKey || '');
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<TFitBackupSnapshot | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);

  if (!isSettingsOpen) return null;

  const saveCloudConfig = async (enabledOverride?: boolean) => {
    await updateAppSettings({
      cloudSyncUrl: syncUrl.trim() || '/api/sync',
      cloudSyncKey: syncKey.trim(),
      cloudSyncEnabled:
        enabledOverride !== undefined ? enabledOverride : settings.cloudSyncEnabled,
    });
    pushToast('Saved sync settings.');
  };

  const testCloudHealth = async () => {
    setHealthResult('Checking...');
    try {
      const h = await checkCloudSyncHealth(syncUrl.trim() || '/api/sync');
      if (!h.reachable) {
        setHealthResult('Endpoint unreachable.');
      } else if (!h.dbBound) {
        setHealthResult('Worker reachable · D1 binding (DB) not attached.');
      } else {
        setHealthResult(
          `Connected · ${h.recordCount} records · ${h.authProtected ? 'Key active' : 'No key'}`
        );
      }
    } catch {
      setHealthResult('Endpoint unreachable.');
    }
  };

  const handleBackupFileSelect = async (file: File) => {
    try {
      const parsed = validateBackupSnapshot(JSON.parse(await file.text()));
      setPendingSnapshot(parsed);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Invalid backup file.', 'danger');
    }
  };

  const applyPendingSnapshot = async (mode: 'merge' | 'replace') => {
    if (!pendingSnapshot) return;
    const res = await restoreFromBackupSnapshot(pendingSnapshot, mode);
    setPendingSnapshot(null);
    pushToast(
      mode === 'replace'
        ? `Restored ${res.appliedCount} records.`
        : `Merged ${res.appliedCount} records.`
    );
  };

  const handleExportCsv = async () => {
    const allWorkouts = await db.workouts.filter((w) => !w.deletedAt).toArray();
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const csv = exportWorkoutsToCsv(allWorkouts, clientMap, exerciseMap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadOrShareFile(blob, `T-workouts-${stamp}.csv`, 'T! Workouts CSV', false);
    pushToast('Exported CSV.');
  };

  const handleImportCsv = async (file: File) => {
    if (!activeClient) return;
    setImportingCsv(true);
    try {
      const res = importExternalWorkoutsCsv(await file.text(), activeClient.id, exercises);
      await db.transaction('rw', [db.exercises, db.workouts], async () => {
        if (res.newExercises.length > 0) await db.exercises.bulkPut(res.newExercises);
        if (res.workouts.length > 0) await db.workouts.bulkPut(res.workouts);
      });
      pushToast(`Imported ${res.workouts.length} workouts (${res.importedSets} sets).`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'CSV import failed.', 'danger');
    } finally {
      setImportingCsv(false);
    }
  };

  const togglePlate = async (p: number) => {
    const exists = settings.plateInventoryKg.includes(p);
    const next = exists
      ? settings.plateInventoryKg.filter((x) => x !== p)
      : [...settings.plateInventoryKg, p].sort((a, b) => b - a);
    if (next.length === 0) return;
    await updateAppSettings({ plateInventoryKg: next });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div className="modal-sheet">
        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <button
            type="button"
            className="nav-icon-btn"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
          >
            <X size={19} />
          </button>
        </div>

        <div className="modal-body">
          {/* DAILY SYNC FILE BACKUP */}
          <div className="section-block">
            <span className="section-label">Daily Sync File</span>
            <div className="list-group">
              <button
                id="settings-export-backup-btn"
                type="button"
                className="list-row interactive"
                onClick={() => void triggerEndOfDayBackupExport(true)}
              >
                <div className="list-row-body">
                  <span className="row-title">Export Sync File (.tfit.json)</span>
                  <span className="row-sub tabular">
                    {settings.lastBackupExportAt > 0
                      ? `Last: ${new Date(settings.lastBackupExportAt).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : 'Not exported yet'}
                  </span>
                </div>
                <Download size={17} style={{ color: 'var(--accent)' }} />
              </button>

              <label className="list-row interactive">
                <div className="list-row-body">
                  <span className="row-title">Import Sync File</span>
                  <span className="row-sub">Restore or merge a .tfit.json backup</span>
                </div>
                <Upload size={17} style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="file"
                  accept=".json,.tfit.json,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleBackupFileSelect(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {pendingSnapshot && (
              <div className="surface-panel col" style={{ gap: 10 }}>
                <div className="row-title tabular">
                  Backup · {new Date(pendingSnapshot.exportedAt).toLocaleDateString('en-GB')}
                </div>
                <div className="row-sub tabular">
                  {pendingSnapshot.stats.clients} clients · {pendingSnapshot.stats.workouts} workouts
                </div>
                <div className="field-row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void applyPendingSnapshot('merge')}
                  >
                    Smart Merge
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-text btn-sm"
                    onClick={() => void applyPendingSnapshot('replace')}
                  >
                    Full Restore
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CLOUDFLARE D1 SYNC */}
          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Cloudflare D1 Sync</span>
              <button
                type="button"
                className="btn-text"
                style={{ minHeight: 28, fontSize: 13 }}
                onClick={() => void saveCloudConfig(!settings.cloudSyncEnabled)}
              >
                {settings.cloudSyncEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="surface-panel col" style={{ gap: 12 }}>
              <div className="field">
                <label>Endpoint</label>
                <input
                  type="text"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  placeholder="/api/sync"
                />
              </div>
              <div className="field">
                <label>Coach Sync Key</label>
                <input
                  type="password"
                  value={syncKey}
                  onChange={(e) => setSyncKey(e.target.value)}
                  placeholder="COACH_SYNC_KEY"
                />
              </div>
              {healthResult && <div className="row-sub">{healthResult}</div>}
              <div className="field-row">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void testCloudHealth()}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={syncing}
                  onClick={async () => {
                    await saveCloudConfig(true);
                    await triggerCloudSync(false);
                  }}
                >
                  <RefreshCw size={14} /> {syncing ? 'Syncing' : 'Sync Now'}
                </button>
              </div>
            </div>
          </div>

          {/* CSV IMPORT & EXPORT */}
          <div className="section-block">
            <span className="section-label">CSV Data</span>
            <div className="list-group">
              <label className="list-row interactive">
                <div className="list-row-body">
                  <span className="row-title">
                    {importingCsv ? 'Importing…' : 'Import Strong / Hevy / Jefit CSV'}
                  </span>
                  <span className="row-sub">Imports into {activeClient?.name}</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImportCsv(f);
                    e.target.value = '';
                  }}
                />
              </label>

              <button
                type="button"
                className="list-row interactive"
                onClick={() => void handleExportCsv()}
              >
                <div className="list-row-body">
                  <span className="row-title">Export All Workouts (CSV)</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>
          </div>

          {/* BARBELL & PLATES */}
          <div className="section-block">
            <span className="section-label">Equipment</span>
            <div className="surface-panel col" style={{ gap: 12 }}>
              <div className="field">
                <label>Barbell Weight</label>
                <select
                  value={settings.barbellWeightKg}
                  onChange={(e) =>
                    void updateAppSettings({ barbellWeightKg: Number(e.target.value) })
                  }
                >
                  <option value={20}>20 kg</option>
                  <option value={15}>15 kg</option>
                  <option value={25}>25 kg</option>
                </select>
              </div>
              <div className="pill-row">
                {ALL_PLATES_KG.map((p) => {
                  const active = settings.plateInventoryKg.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`pill tabular ${active ? 'active' : ''}`}
                      onClick={() => void togglePlate(p)}
                    >
                      {p}kg
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RESET DEMO */}
          <div className="section-block">
            <span className="section-label">Roster</span>
            <div className="list-group">
              <button
                type="button"
                className="list-row interactive"
                onClick={async () => {
                  await clearDemoClientsKeepPersonal();
                  pushToast('Cleared sample clients.');
                  setSettingsOpen(false);
                }}
              >
                <span className="row-title" style={{ color: 'var(--danger)' }}>
                  Clear Sample Clients
                </span>
                <span className="row-sub">Keep Personal Profile</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
