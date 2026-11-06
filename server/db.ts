// SQLite persistence (Node's built-in node:sqlite, no native deps).
import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS journeys (
      id TEXT PRIMARY KEY,
      device TEXT NOT NULL,
      token TEXT NOT NULL,
      share_id TEXT NOT NULL UNIQUE,
      graph_version TEXT NOT NULL,
      mode TEXT NOT NULL,
      route_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      dest_lon REAL NOT NULL, dest_lat REAL NOT NULL,
      eta_s REAL NOT NULL,
      started_at INTEGER NOT NULL,
      arrived_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',  -- active | arrived | ended | sos
      eligible INTEGER NOT NULL DEFAULT 0,
      coverage REAL,
      review_token TEXT,
      reviewed INTEGER NOT NULL DEFAULT 0,
      traveller_name TEXT,
      simulated INTEGER NOT NULL DEFAULT 0,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS fixes (
      journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      t INTEGER NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL, acc REAL NOT NULL,
      PRIMARY KEY (journey_id, t)
    );
    -- one vote per device per segment (latest wins), so a single person
    -- walking the same road 20 times still counts once
    CREATE TABLE IF NOT EXISTS edge_votes (
      graph_version TEXT NOT NULL,
      edge INTEGER NOT NULL,
      device TEXT NOT NULL,
      rating INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (graph_version, edge, device)
    );
    CREATE INDEX IF NOT EXISTS edge_votes_v ON edge_votes(graph_version, edge);
    -- live safety reports (expire after a few hours)
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      lon REAL NOT NULL, lat REAL NOT NULL,
      device TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_exp ON reports(expires_at);
    CREATE TABLE IF NOT EXISTS report_votes (
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      device TEXT NOT NULL,
      still INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (report_id, device)
    );
  `);
  // migrate older databases
  const cols = (db.prepare("PRAGMA table_info(journeys)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('simulated')) db.exec('ALTER TABLE journeys ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0');
  const vcols = (db.prepare("PRAGMA table_info(edge_votes)").all() as { name: string }[]).map((c) => c.name);
  if (!vcols.includes('tags')) db.exec("ALTER TABLE edge_votes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('ended_at')) db.exec('ALTER TABLE journeys ADD COLUMN ended_at INTEGER');
  // older versions kept reviews with comments linked to trips; nothing like that is kept now
  db.exec('DROP TABLE IF EXISTS reviews');
  return db;
}
