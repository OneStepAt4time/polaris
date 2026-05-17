import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";

export interface EventRow {
  requestId: string;
  sessionFile: string;
  tsMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  rawCostUsd: number | null;
}

export interface PolarisDb {
  insertEvent(e: EventRow): boolean;
  countEvents(): number;
  getEventsInRange(fromMs: number, toMs: number): EventRow[];
  close(): void;
}

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events (
     request_id TEXT PRIMARY KEY,
     session_file TEXT NOT NULL,
     ts_ms INTEGER NOT NULL,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens INTEGER NOT NULL DEFAULT 0,
     cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
     raw_cost_usd REAL
   )`,
  "CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_file)",
  "CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms)",
];

function runMigrations(db: DatabaseType): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _polaris_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const appliedRows = db.prepare("SELECT id FROM _polaris_migrations").all() as { id: number }[];
  const applied = new Set(appliedRows.map((r) => r.id));
  const insertMigration = db.prepare(
    "INSERT INTO _polaris_migrations (id, applied_at) VALUES (?, ?)",
  );
  for (let i = 0; i < MIGRATIONS.length; i += 1) {
    if (applied.has(i)) continue;
    db.exec(MIGRATIONS[i] as string);
    insertMigration.run(i, Date.now());
  }
}

export function openDb(path: string): PolarisDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO events
     (request_id, session_file, ts_ms, model, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, raw_cost_usd)
     VALUES (@requestId, @sessionFile, @tsMs, @model, @inputTokens, @outputTokens,
      @cacheReadTokens, @cacheCreationTokens, @rawCostUsd)`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM events");
  const rangeStmt = db.prepare(
    `SELECT request_id AS requestId, session_file AS sessionFile, ts_ms AS tsMs,
            model, input_tokens AS inputTokens, output_tokens AS outputTokens,
            cache_read_tokens AS cacheReadTokens, cache_creation_tokens AS cacheCreationTokens,
            raw_cost_usd AS rawCostUsd
     FROM events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms ASC`,
  );

  return {
    insertEvent: (e: EventRow): boolean => {
      const info = insertStmt.run(e);
      return info.changes > 0;
    },
    countEvents: (): number => {
      const row = countStmt.get() as { n: number };
      return row.n;
    },
    getEventsInRange: (fromMs: number, toMs: number): EventRow[] => {
      return rangeStmt.all(fromMs, toMs) as EventRow[];
    },
    close: (): void => {
      db.close();
    },
  };
}
