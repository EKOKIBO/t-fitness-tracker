import { useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Download,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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
    pushToast('Saved Cloud Sync settings.', 'positive');
  };

  const testCloudHealth = async () => {
    setHealthResult('Checking endpoint...');
    try {
      const h = await checkCloudSyncHealth(syncUrl.trim() || '/api/sync');
      if (!h.reachable) {
        setHealthResult('Endpoint unreachable (local-only mode still works 100%).');
      } else if (!h.dbBound) {
        setHealthResult('Connected to Cloudflare Worker, but D1 binding (DB) is not attached yet.');
      } else {
        setHealthResult(
          `Connected ✓ · D1 Ready (${h.recordCount} synced records · Auth ${
            h.authProtected ? 'Protected' : 'Open'
          })`
        );
      }
    } catch {
      setHealthResult('Could not reach /api/health (expected when running pure static dev server).');
    }
  };

  const handleBackupFileSelect = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = validateBackupSnapshot(JSON.parse(text));
      setPendingSnapshot(parsed);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Invalid backup file.',
        'danger'
      );
    }
  };

  const applyPendingSnapshot = async (mode: 'merge' | 'replace') => {
    if (!pendingSnapshot) return;
    const res = await restoreFromBackupSnapshot(pendingSnapshot, mode);
    setPendingSnapshot(null);
    pushToast(
      mode === 'replace'
        ? `Restored full vault (${res.appliedCount} records).`
        : `Smart-merged ${res.appliedCount} records safely!`,
      'positive'
    );
  };

  const handleExportCsv = async () => {
    const allWorkouts = await db.workouts.filter((w) => !w.deletedAt).toArray();
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const csv = exportWorkoutsToCsv(allWorkouts, clientMap, exerciseMap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadOrShareFile(blob, `T-workouts-export-${stamp}.csv`, 'T! Workouts CSV', false);
    pushToast('Exported lossless workouts CSV!', 'positive');
  };

  const handleImportCsv = async (file: File) => {
    if (!activeClient) return;
    setImportingCsv(true);
    try {
      const text = await file.text();
      const res = importExternalWorkoutsCsv(text, activeClient.id, exercises);
      await db.transaction('rw', [db.exercises, db.workouts], async () => {
        if (res.newExercises.length > 0) await db.exercises.bulkPut(res.newExercises);
        if (res.workouts.length > 0) await db.workouts.bulkPut(res.workouts);
      });
      pushToast(
        `Imported ${res.workouts.length} workouts (${res.importedSets} sets) from ${res.format.toUpperCase()} CSV for ${activeClient.name}!`,
        'positive'
      );
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
          <div>
            <h2 className="card-title">Settings, Cloud Sync &amp; Backups</h2>
            <p className="card-meta">Local-First IndexedDB · €0 Cloudflare D1 Sync · Portability</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* 1. END-OF-DAY SYNC BACKUP FILE (.tfit.json) */}
          <div className="card card-compact col" style={{ gap: 10 }}>
            <div className="row">
              <ShieldCheck size={16} style={{ color: 'var(--accent-pr)' }} />
              <strong style={{ fontSize: 14 }}>End-of-Day Sync File Backup (.tfit.json)</strong>
            </div>
            <p className="card-meta">
              Export a complete encrypted-safe JSON snapshot of all clients, workouts, progression states, and measurements at the end of the day. Re-import anytime if browser/device data is wiped.
            </p>

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                id="settings-export-backup-btn"
                type="button"
                className="btn btn-amber btn-sm"
                style={{ flex: 1 }}
                onClick={() => void triggerEndOfDayBackupExport(true)}
              >
                <Download size={14} /> Export Sync File
              </button>

              <label
                className="btn btn-secondary btn-sm"
                style={{ flex: 1, cursor: 'pointer' }}
              >
                <Upload size={14} /> Import Sync File
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

            {/* Preview & Merge/Replace Confirmation */}
            {pendingSnapshot && (
              <div
                className="card card-compact col"
                style={{
                  background: '#191920',
                  borderColor: 'rgba(0, 122, 255, 0.5)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  Backup Ready: {new Date(pendingSnapshot.exportedAt).toLocaleString('en-GB')}
                </div>
                <div className="card-meta tabular">
                  {pendingSnapshot.stats.clients} clients · {pendingSnapshot.stats.workouts}{' '}
                  workouts · {pendingSnapshot.stats.routines} routines ·{' '}
                  {pendingSnapshot.stats.measurements} check-ins
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => void applyPendingSnapshot('merge')}
                  >
                    Smart Merge (Keep Newest)
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => void applyPendingSnapshot('replace')}
                  >
                    Full Restore (Replace All)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. €0 CLOUDFLARE D1 CLOUD SYNC */}
          <div className="card card-compact col" style={{ gap: 10 }}>
            <div className="row-between">
              <div className="row">
                <Cloud size={16} style={{ color: 'var(--accent-primary)' }} />
                <strong style={{ fontSize: 14 }}>€0 Cloudflare D1 Cloud Sync</strong>
              </div>
              <button
                type="button"
                className={`chip ${settings.cloudSyncEnabled ? 'positive' : ''}`}
                onClick={() => void saveCloudConfig(!settings.cloudSyncEnabled)}
              >
                {settings.cloudSyncEnabled ? 'Enabled' : 'Disabled (Local-Only)'}
              </button>
            </div>

            <div className="field">
              <label>Sync API Endpoint (default <code>/api/sync</code> on Cloudflare)</label>
              <input
                type="text"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
                placeholder="/api/sync"
              />
            </div>

            <div className="field">
              <label>Coach Sync Key (matches <code>COACH_SYNC_KEY</code> secret in Cloudflare)</label>
              <input
                type="password"
                value={syncKey}
                onChange={(e) => setSyncKey(e.target.value)}
                placeholder="Your private passphrase"
              />
            </div>

            {healthResult && (
              <div className="card-meta" style={{ color: 'var(--text-primary)' }}>
                {healthResult}
              </div>
            )}

            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void saveCloudConfig()}
              >
                <CheckCircle2 size={14} /> Save Config
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void testCloudHealth()}
              >
                Test Connection
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
                <RefreshCw size={14} /> {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {settings.lastSyncAt > 0 && (
              <div className="card-meta tabular">
                Last cloud sync: {new Date(settings.lastSyncAt).toLocaleString('en-GB')}
              </div>
            )}
          </div>

          {/* 3. UNIVERSAL CSV PORTABILITY (STRONG / HEVY / JEFIT) */}
          <div className="card card-compact col" style={{ gap: 10 }}>
            <div className="row">
              <FileSpreadsheet size={16} style={{ color: 'var(--accent-positive)' }} />
              <strong style={{ fontSize: 14 }}>Universal CSV Import &amp; Export</strong>
            </div>
            <p className="card-meta">
              Import historical workouts from <strong>Strong</strong>, <strong>Hevy</strong>, or{' '}
              <strong>Jefit</strong> CSV files into{' '}
              <strong>{activeClient?.name ?? 'active client'}</strong>, or export all T! logs to CSV.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <label
                className="btn btn-secondary btn-sm"
                style={{ flex: 1, cursor: 'pointer' }}
              >
                <Upload size={14} /> {importingCsv ? 'Importing...' : 'Import Strong/Hevy CSV'}
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
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
                onClick={() => void handleExportCsv()}
              >
                <Download size={14} /> Export All CSV
              </button>
            </div>
          </div>

          {/* 4. GYM EQUIPMENT INVENTORY */}
          <div className="card card-compact col" style={{ gap: 10 }}>
            <strong style={{ fontSize: 14 }}>Barbell &amp; Plate Solver Inventory</strong>
            <div className="field">
              <label>Default Empty Barbell (kg)</label>
              <select
                value={settings.barbellWeightKg}
                onChange={(e) =>
                  void updateAppSettings({ barbellWeightKg: Number(e.target.value) })
                }
              >
                <option value={20}>20 kg (Standard Olympic)</option>
                <option value={15}>15 kg (Women's Olympic)</option>
                <option value={25}>25 kg (Trap / Safety Bar)</option>
              </select>
            </div>
            <div className="col" style={{ gap: 5 }}>
              <span className="section-label">Available Plates (kg)</span>
              <div className="chip-row">
                {ALL_PLATES_KG.map((p) => {
                  const active = settings.plateInventoryKg.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`chip tabular ${active ? 'active' : ''}`}
                      onClick={() => void togglePlate(p)}
                    >
                      {p}kg
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5. QUIET MODE & DEMO RESET */}
          <div className="card card-compact row-between">
            <div>
              <strong style={{ fontSize: 13.5 }}>Start Clean for Real Roster</strong>
              <div className="card-meta">
                Archives the 3 sample clients (Marcus, Elena, Lukas) &amp; keeps Personal Profile + templates.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-danger-soft btn-sm"
              onClick={async () => {
                await clearDemoClientsKeepPersonal();
                pushToast('Demo clients archived! Ready to add your real roster.', 'positive');
                setSettingsOpen(false);
              }}
            >
              <Trash2 size={14} /> Clear Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
