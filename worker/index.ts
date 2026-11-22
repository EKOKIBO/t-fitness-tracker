/// <reference types="@cloudflare/workers-types" />

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  COACH_SYNC_KEY?: string;
}

interface SyncEnvelopeItem {
  collection: string;
  id: string;
  payload: unknown;
  updatedAt: number;
  deletedAt?: number | null;
}

interface SyncRequestBody {
  since: number;
  changes: SyncEnvelopeItem[];
}

const ALLOWED_COLLECTIONS = new Set([
  'clients',
  'exercises',
  'clientExerciseNotes',
  'routineFolders',
  'routines',
  'programs',
  'clientProgramEnrollments',
  'workouts',
  'measurements',
]);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Coach-Key',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function handleHealth(env: Env): Promise<Response> {
  const dbBound = Boolean(env.DB);
  let dbReady = false;
  let recordCount = 0;

  if (env.DB) {
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS sync_records (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER,
          PRIMARY KEY (collection, id)
        )`
      ).run();
      const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sync_records').first<{
        cnt: number;
      }>();
      dbReady = true;
      recordCount = row?.cnt ?? 0;
    } catch {
      dbReady = false;
    }
  }

  return jsonResponse({
    ok: true,
    app: 'T!',
    dbBound,
    dbReady,
    authProtected: Boolean(env.COACH_SYNC_KEY),
    recordCount,
    serverTime: Date.now(),
  });
}

async function handleSync(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse(
      {
        error:
          'Cloudflare D1 database (DB) is not bound yet. Create t-fitness-db and bind it as DB in wrangler.toml or Cloudflare Dashboard.',
      },
      503
    );
  }

  if (env.COACH_SYNC_KEY && env.COACH_SYNC_KEY.trim().length > 0) {
    const provided = request.headers.get('X-Coach-Key') ?? '';
    const [expectedHash, providedHash] = await Promise.all([
      sha256Hex(env.COACH_SYNC_KEY.trim()),
      sha256Hex(provided.trim()),
    ]);
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return jsonResponse({ error: 'Invalid Coach Sync Key.' }, 401);
    }
  }

  let body: SyncRequestBody;
  try {
    body = (await request.json()) as SyncRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const since =
    typeof body.since === 'number' && Number.isFinite(body.since) ? body.since : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];

  // Auto-initialize D1 table on first sync
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sync_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      PRIMARY KEY (collection, id)
    )`
  ).run();

  const validChanges = changes.filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      ALLOWED_COLLECTIONS.has(item.collection) &&
      typeof item.updatedAt === 'number'
  );

  let appliedCount = 0;
  if (validChanges.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT INTO sync_records (collection, id, payload, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(collection, id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       WHERE excluded.updated_at >= sync_records.updated_at`
    );

    for (let i = 0; i < validChanges.length; i += 50) {
      const slice = validChanges.slice(i, i + 50);
      await env.DB.batch(
        slice.map((item) =>
          stmt.bind(
            item.collection,
            item.id,
            JSON.stringify(item.payload),
            item.updatedAt,
            item.deletedAt ?? null
          )
        )
      );
      appliedCount += slice.length;
    }
  }

  const rows = await env.DB.prepare(
    `SELECT collection, id, payload, updated_at, deleted_at
     FROM sync_records
     WHERE updated_at > ?1
     ORDER BY updated_at ASC`
  )
    .bind(since)
    .all<{
      collection: string;
      id: string;
      payload: string;
      updated_at: number;
      deleted_at: number | null;
    }>();

  const serverChanges: SyncEnvelopeItem[] = (rows.results ?? []).map((r) => ({
    collection: r.collection,
    id: r.id,
    payload: JSON.parse(r.payload),
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));

  return jsonResponse({
    ok: true,
    serverTime: Date.now(),
    appliedCount,
    changes: serverChanges,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleSync(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
