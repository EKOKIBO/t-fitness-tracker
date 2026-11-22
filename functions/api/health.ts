/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB?: D1Database;
  COACH_SYNC_KEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const dbBound = Boolean(env.DB);
  let dbReady = false;
  let recordCount = 0;

  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sync_records').first<{ cnt: number }>();
      dbReady = true;
      recordCount = row?.cnt ?? 0;
    } catch {
      dbReady = false;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      app: 'T!',
      dbBound,
      dbReady,
      authProtected: Boolean(env.COACH_SYNC_KEY),
      recordCount,
      serverTime: Date.now(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
};
