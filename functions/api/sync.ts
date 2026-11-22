/// <reference types="@cloudflare/workers-types" />

interface Env {
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Coach-Key',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        error: 'Cloudflare D1 database (DB) is not bound yet. Bind DB in Cloudflare Pages Settings.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // Verify Coach Sync Key if configured in Cloudflare environment variables
  if (env.COACH_SYNC_KEY && env.COACH_SYNC_KEY.trim().length > 0) {
    const provided = request.headers.get('X-Coach-Key') ?? '';
    const [expectedHash, providedHash] = await Promise.all([
      sha256Hex(env.COACH_SYNC_KEY.trim()),
      sha256Hex(provided.trim()),
    ]);
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return new Response(JSON.stringify({ error: 'Invalid Coach Sync Key.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  }

  let body: SyncRequestBody;
  try {
    body = (await request.json()) as SyncRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const since = typeof body.since === 'number' && Number.isFinite(body.since) ? body.since : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];

  // Ensure table exists automatically on first sync even if user skipped manual SQL migration
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

  // Upsert incoming changes using Last-Write-Wins on updated_at
  const validChanges = changes.filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      ALLOWED_COLLECTIONS.has(item.collection) &&
      typeof item.updatedAt === 'number'
  );

  let appliedCount = 0;
  if (validChanges.length > 0) {
    // Batch in chunks of 50 statements for D1 limits
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

  // Pull all server records updated strictly after `since`
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

  return new Response(
    JSON.stringify({
      ok: true,
      serverTime: Date.now(),
      appliedCount,
      changes: serverChanges,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
      },
    }
  );
};
