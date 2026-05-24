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
  /** Lines added by Edit/Write/MultiEdit tool calls on this event. v0.23.0. */
  linesAdded?: number;
  /** Lines removed by Edit/MultiEdit tool calls on this event. v0.23.0. */
  linesRemoved?: number;
}

export interface RateLimitSample {
  tsMs: number;
  httpStatus: number;
  rawJson: string | null;
  error: string | null;
}

export interface AcpSessionRow {
  id: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  status: string;
  endedAt: number | null;
  endReason: string | null;
  settingsJson: string | null;
}

export interface SessionMessageRow {
  id: number;
  sessionId: string;
  tsMs: number;
  kind: string;
  payloadJson: string;
}

export interface PerModelAggregateRow {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  linesAdded: number;
  linesRemoved: number;
  rawCostUsdSum: number | null;
  rawCostUsdCount: number;
}

export interface PolarisDb {
  insertEvent(e: EventRow): boolean;
  countEvents(): number;
  getEventsInRange(fromMs: number, toMs: number): EventRow[];
  /**
   * Aggregate-by-model query used by /v1/metrics. Pushes SUM/COUNT/GROUP BY
   * down to SQLite so the hot path returns ~5 rows instead of 10k. v0.24.0.
   */
  aggregateByModel(fromMs: number, toMs: number): PerModelAggregateRow[];
  wasNotified(ruleName: string, dedupKey: string): boolean;
  markNotified(ruleName: string, dedupKey: string, sentAtMs: number): void;
  insertRateLimitSample(s: RateLimitSample): void;
  getLatestRateLimitSample(): RateLimitSample | null;
  upsertAcpSession(row: AcpSessionRow): void;
  closeAcpSession(id: string, endedAt: number, reason: string): void;
  listAcpSessions(): AcpSessionRow[];
  getAcpSession(id: string): AcpSessionRow | null;
  appendSessionMessage(row: Omit<SessionMessageRow, "id">): void;
  getSessionMessages(sessionId: string): SessionMessageRow[];
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
  `CREATE TABLE IF NOT EXISTS notifications_sent (
     rule_name TEXT NOT NULL,
     dedup_key TEXT NOT NULL,
     sent_at INTEGER NOT NULL,
     PRIMARY KEY (rule_name, dedup_key)
   )`,
  `CREATE TABLE IF NOT EXISTS rate_history (
     ts_ms INTEGER PRIMARY KEY,
     http_status INTEGER NOT NULL,
     raw_json TEXT,
     error TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS acp_sessions (
     id TEXT PRIMARY KEY,
     cwd TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_activity_at INTEGER NOT NULL,
     status TEXT NOT NULL,
     ended_at INTEGER,
     end_reason TEXT,
     settings_json TEXT
   )`,
  "CREATE INDEX IF NOT EXISTS idx_acp_sessions_created ON acp_sessions(created_at DESC)",
  `CREATE TABLE IF NOT EXISTS session_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL,
     ts_ms INTEGER NOT NULL,
     kind TEXT NOT NULL,
     payload_json TEXT NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS idx_session_messages_sid ON session_messages(session_id, ts_ms)",
  // v0.23.0: line acceptance metrics. ALTER TABLE ADD COLUMN with default 0
  // is backward-compatible with rows already in the DB — old events read as 0
  // lines, new ones are populated by parser.ts.
  "ALTER TABLE events ADD COLUMN lines_added INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE events ADD COLUMN lines_removed INTEGER NOT NULL DEFAULT 0",
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
      cache_read_tokens, cache_creation_tokens, raw_cost_usd,
      lines_added, lines_removed)
     VALUES (@requestId, @sessionFile, @tsMs, @model, @inputTokens, @outputTokens,
      @cacheReadTokens, @cacheCreationTokens, @rawCostUsd,
      @linesAdded, @linesRemoved)`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM events");
  const rangeStmt = db.prepare(
    `SELECT request_id AS requestId, session_file AS sessionFile, ts_ms AS tsMs,
            model, input_tokens AS inputTokens, output_tokens AS outputTokens,
            cache_read_tokens AS cacheReadTokens, cache_creation_tokens AS cacheCreationTokens,
            raw_cost_usd AS rawCostUsd,
            lines_added AS linesAdded, lines_removed AS linesRemoved
     FROM events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms ASC`,
  );
  const aggByModelStmt = db.prepare(
    `SELECT model,
            COUNT(*) AS events,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
            COALESCE(SUM(lines_added), 0) AS linesAdded,
            COALESCE(SUM(lines_removed), 0) AS linesRemoved,
            SUM(raw_cost_usd) AS rawCostUsdSum,
            COUNT(raw_cost_usd) AS rawCostUsdCount
     FROM events WHERE ts_ms >= ? AND ts_ms <= ?
     GROUP BY model`,
  );
  const notifyExistsStmt = db.prepare(
    "SELECT 1 FROM notifications_sent WHERE rule_name = ? AND dedup_key = ? LIMIT 1",
  );
  const notifyInsertStmt = db.prepare(
    "INSERT OR REPLACE INTO notifications_sent (rule_name, dedup_key, sent_at) VALUES (?, ?, ?)",
  );
  const rateInsertStmt = db.prepare(
    `INSERT OR REPLACE INTO rate_history (ts_ms, http_status, raw_json, error)
     VALUES (@tsMs, @httpStatus, @rawJson, @error)`,
  );
  const rateLatestStmt = db.prepare(
    `SELECT ts_ms AS tsMs, http_status AS httpStatus, raw_json AS rawJson, error
     FROM rate_history ORDER BY ts_ms DESC LIMIT 1`,
  );
  const acpUpsertStmt = db.prepare(
    `INSERT INTO acp_sessions
       (id, cwd, created_at, last_activity_at, status, ended_at, end_reason, settings_json)
     VALUES (@id, @cwd, @createdAt, @lastActivityAt, @status, @endedAt, @endReason, @settingsJson)
     ON CONFLICT(id) DO UPDATE SET
       last_activity_at = excluded.last_activity_at,
       status = excluded.status,
       ended_at = COALESCE(acp_sessions.ended_at, excluded.ended_at),
       end_reason = COALESCE(acp_sessions.end_reason, excluded.end_reason),
       settings_json = COALESCE(excluded.settings_json, acp_sessions.settings_json)`,
  );
  const acpCloseStmt = db.prepare(
    `UPDATE acp_sessions SET status = 'closed', ended_at = ?, end_reason = ?
     WHERE id = ? AND ended_at IS NULL`,
  );
  const acpListStmt = db.prepare(
    `SELECT id, cwd, created_at AS createdAt, last_activity_at AS lastActivityAt,
            status, ended_at AS endedAt, end_reason AS endReason,
            settings_json AS settingsJson
     FROM acp_sessions ORDER BY created_at DESC`,
  );
  const acpGetStmt = db.prepare(
    `SELECT id, cwd, created_at AS createdAt, last_activity_at AS lastActivityAt,
            status, ended_at AS endedAt, end_reason AS endReason,
            settings_json AS settingsJson
     FROM acp_sessions WHERE id = ?`,
  );
  const messageInsertStmt = db.prepare(
    `INSERT INTO session_messages (session_id, ts_ms, kind, payload_json)
     VALUES (@sessionId, @tsMs, @kind, @payloadJson)`,
  );
  const messageListStmt = db.prepare(
    `SELECT id, session_id AS sessionId, ts_ms AS tsMs, kind, payload_json AS payloadJson
     FROM session_messages WHERE session_id = ? ORDER BY id ASC`,
  );

  return {
    insertEvent: (e: EventRow): boolean => {
      const info = insertStmt.run({
        ...e,
        linesAdded: e.linesAdded ?? 0,
        linesRemoved: e.linesRemoved ?? 0,
      });
      return info.changes > 0;
    },
    countEvents: (): number => {
      const row = countStmt.get() as { n: number };
      return row.n;
    },
    getEventsInRange: (fromMs: number, toMs: number): EventRow[] => {
      return rangeStmt.all(fromMs, toMs) as EventRow[];
    },
    aggregateByModel: (fromMs: number, toMs: number): PerModelAggregateRow[] => {
      return aggByModelStmt.all(fromMs, toMs) as PerModelAggregateRow[];
    },
    wasNotified: (ruleName: string, dedupKey: string): boolean => {
      return notifyExistsStmt.get(ruleName, dedupKey) !== undefined;
    },
    markNotified: (ruleName: string, dedupKey: string, sentAtMs: number): void => {
      notifyInsertStmt.run(ruleName, dedupKey, sentAtMs);
    },
    insertRateLimitSample: (s: RateLimitSample): void => {
      rateInsertStmt.run(s);
    },
    getLatestRateLimitSample: (): RateLimitSample | null => {
      const row = rateLatestStmt.get() as RateLimitSample | undefined;
      return row ?? null;
    },
    upsertAcpSession: (row: AcpSessionRow): void => {
      acpUpsertStmt.run(row);
    },
    closeAcpSession: (id: string, endedAt: number, reason: string): void => {
      acpCloseStmt.run(endedAt, reason, id);
    },
    listAcpSessions: (): AcpSessionRow[] => {
      return acpListStmt.all() as AcpSessionRow[];
    },
    getAcpSession: (id: string): AcpSessionRow | null => {
      const row = acpGetStmt.get(id) as AcpSessionRow | undefined;
      return row ?? null;
    },
    appendSessionMessage: (row: Omit<SessionMessageRow, "id">): void => {
      messageInsertStmt.run(row);
    },
    getSessionMessages: (sessionId: string): SessionMessageRow[] => {
      return messageListStmt.all(sessionId) as SessionMessageRow[];
    },
    close: (): void => {
      db.close();
    },
  };
}
