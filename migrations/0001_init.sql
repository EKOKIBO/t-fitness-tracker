-- T! Strength & Coaching OS — Cloudflare D1 Delta Sync Schema
-- Run this once in the Cloudflare Dashboard -> D1 -> Console (or via wrangler d1 execute)

CREATE TABLE IF NOT EXISTS sync_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_updated_at
  ON sync_records (updated_at);
