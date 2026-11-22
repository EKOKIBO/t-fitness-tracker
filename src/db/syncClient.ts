import type { EntityTable } from 'dexie';
import { db, getSettings, updateSettings } from './database';

export interface SyncEnvelopeItem {
  collection: string;
  id: string;
  payload: Record<string, unknown>;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  serverTime: number;
  message: string;
}

type SyncCollectionName =
  | 'clients'
  | 'exercises'
  | 'clientExerciseNotes'
  | 'routineFolders'
  | 'routines'
  | 'programs'
  | 'clientProgramEnrollments'
  | 'workouts'
  | 'measurements';

function getTable(name: SyncCollectionName): EntityTable<{ id: string; updatedAt: number; deletedAt?: number | null }, 'id'> {
  return db[name] as unknown as EntityTable<
    { id: string; updatedAt: number; deletedAt?: number | null },
    'id'
  >;
}

const SYNC_COLLECTIONS: SyncCollectionName[] = [
  'clients',
  'exercises',
  'clientExerciseNotes',
  'routineFolders',
  'routines',
  'programs',
  'clientProgramEnrollments',
  'workouts',
  'measurements',
];

/**
 * Performs bidirectional Last-Write-Wins (LWW) delta sync with Cloudflare Pages Function /api/sync.
 * Works cleanly offline (exits gracefully without touching local data).
 */
export async function runCloudDeltaSync(): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.cloudSyncEnabled) {
    return {
      ok: false,
      pushed: 0,
      pulled: 0,
      serverTime: Date.now(),
      message: 'Cloud sync is paused (Local-only mode).',
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      pushed: 0,
      pulled: 0,
      serverTime: Date.now(),
      message: 'Offline — changes queued safely in local IndexedDB.',
    };
  }

  const since = settings.lastSyncAt || 0;
  const outgoing: SyncEnvelopeItem[] = [];

  for (const col of SYNC_COLLECTIONS) {
    const table = getTable(col);
    const modified = await table.where('updatedAt').above(since).toArray();
    for (const rec of modified) {
      outgoing.push({
        collection: col,
        id: rec.id,
        payload: rec as unknown as Record<string, unknown>,
        updatedAt: rec.updatedAt,
        deletedAt: rec.deletedAt ?? null,
      });
    }
  }

  const endpoint = (settings.cloudSyncUrl || '/api/sync').trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.cloudSyncKey.trim()) {
    headers['X-Coach-Key'] = settings.cloudSyncKey.trim();
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ since, changes: outgoing }),
  });

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) errDetail = errJson.error;
    } catch {
      // ignore non-JSON body
    }
    throw new Error(errDetail);
  }

  const body = (await response.json()) as {
    ok: boolean;
    serverTime: number;
    appliedCount: number;
    changes: SyncEnvelopeItem[];
  };

  let pulled = 0;
  const incoming = Array.isArray(body.changes) ? body.changes : [];

  if (incoming.length > 0) {
    await db.transaction(
      'rw',
      SYNC_COLLECTIONS.map((c) => getTable(c)),
      async () => {
        for (const item of incoming) {
          if (!SYNC_COLLECTIONS.includes(item.collection as SyncCollectionName)) continue;
          const table = getTable(item.collection as SyncCollectionName);
          const local = await table.get(item.id);
          if (!local || item.updatedAt > local.updatedAt) {
            await table.put(
              item.payload as unknown as {
                id: string;
                updatedAt: number;
                deletedAt?: number | null;
              }
            );
            pulled++;
          }
        }
      }
    );
  }

  const newCursor = Math.max(since, body.serverTime || Date.now());
  await updateSettings({ lastSyncAt: newCursor });

  return {
    ok: true,
    pushed: outgoing.length,
    pulled,
    serverTime: newCursor,
    message:
      outgoing.length === 0 && pulled === 0
        ? 'Up to date with Cloudflare D1.'
        : `Synced (${outgoing.length} pushed, ${pulled} pulled).`,
  };
}

export async function checkCloudSyncHealth(
  syncUrl = '/api/sync'
): Promise<{ reachable: boolean; dbBound: boolean; dbReady: boolean; authProtected: boolean; recordCount: number }> {
  const healthUrl = syncUrl.replace(/\/sync\/?$/, '/health');
  const res = await fetch(healthUrl, { method: 'GET', cache: 'no-store' });
  if (!res.ok) {
    return { reachable: false, dbBound: false, dbReady: false, authProtected: false, recordCount: 0 };
  }
  const data = (await res.json()) as {
    ok?: boolean;
    dbBound?: boolean;
    dbReady?: boolean;
    authProtected?: boolean;
    recordCount?: number;
  };
  return {
    reachable: Boolean(data.ok),
    dbBound: Boolean(data.dbBound),
    dbReady: Boolean(data.dbReady),
    authProtected: Boolean(data.authProtected),
    recordCount: data.recordCount ?? 0,
  };
}
