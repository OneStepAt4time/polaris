import { randomUUID } from "node:crypto";
import {
  type AcpJsonRpcClient,
  type JsonRpcId,
  createAcpJsonRpcClient,
} from "./json-rpc-client.js";
import { type ProjectSettings, readProjectSettings } from "./project-settings.js";
import { type AcpProcessHandle, spawnAcpProcess } from "./spawner.js";

export type SessionStatus = "idle" | "prompting" | "closed";

export interface SessionUpdate {
  at: number;
  payload: unknown;
}

/**
 * Summary of Claude Code-style files Polaris detected in cwd. Surfaced on the
 * session record so the UI can show "loaded from .mcp.json (2 servers) +
 * CLAUDE.md detected" instead of treating every session as a blank slate.
 */
export interface SessionSettingsInfo {
  claudeMdDetected: boolean;
  claudeSettingsDetected: boolean;
  mcpServers: string[];
  warnings: string[];
}

export interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  status: SessionStatus;
  updates: SessionUpdate[];
  settings?: SessionSettingsInfo;
  /** Number of pending tool-permission requests on this session. v0.20.0. */
  pendingApprovalsCount?: number;
}

export interface CreateSessionOptions {
  cwd: string;
  mcpServers?: unknown[];
}

function settingsToInfo(s: ProjectSettings): SessionSettingsInfo {
  return {
    claudeMdDetected: s.claudeMdPath !== null,
    claudeSettingsDetected: s.claudeSettingsPath !== null,
    mcpServers: s.mcpServers.map((m) => m.name),
    warnings: s.warnings,
  };
}

export interface PromptResult {
  stopReason: string;
  updates: SessionUpdate[];
  usage?: unknown;
  userMessageId?: string;
}

export interface PendingApproval {
  approvalId: string;
  receivedAt: number;
  method: string;
  params: unknown;
}

export type SessionEvent =
  | { type: "update"; at: number; payload: unknown }
  | { type: "approval-request"; at: number; approval: PendingApproval }
  | { type: "session-closed"; at: number };

export type SessionListener = (event: SessionEvent) => void;

export type ApprovalOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

export interface SessionFailure {
  sessionId: string;
  cwd: string;
  reason: string;
  atMs: number;
}

export interface ResumeOptions {
  /**
   * Working directory used when the session was originally created. Required
   * because claude-agent-acp's `session/load` resolves transcripts relative
   * to the cwd-encoded directory under `~/.claude/projects/`.
   */
  cwd: string;
  /**
   * Override the mcpServers list. Defaults to whatever `.mcp.json` in the
   * cwd resolves to (same logic as createSession).
   */
  mcpServers?: unknown[];
}

export interface SessionManager {
  createSession(opts: CreateSessionOptions): Promise<SessionRecord>;
  /**
   * Resume a previously-closed session via ACP `session/load`. Returns the
   * fresh SessionRecord. Throws if the agent rejects the load (e.g. no
   * transcript on disk, or the agent doesn't support session/load). v0.22.0.
   */
  loadSession(id: string, opts: ResumeOptions): Promise<SessionRecord>;
  getSession(id: string): SessionRecord | undefined;
  listSessions(): SessionRecord[];
  sendPrompt(id: string, text: string, timeoutMs?: number): Promise<PromptResult>;
  deleteSession(id: string): Promise<void>;
  close(): Promise<void>;
  subscribe(sessionId: string, listener: SessionListener): () => void;
  listApprovals(sessionId: string): PendingApproval[];
  getApproval(sessionId: string, approvalId: string): PendingApproval | undefined;
  respondToApproval(sessionId: string, approvalId: string, response: ApprovalOutcome): boolean;
  /**
   * Returns the most recent failures (sendPrompt rejections) up to a cap of
   * MAX_FAILURE_BUFFER entries, oldest-first. The buffer is in-memory only;
   * a server restart clears it. Used by the session-failed rule (v0.15.0).
   */
  recentFailures(): SessionFailure[];
  readonly initialized: Promise<void>;
}

export const MAX_FAILURE_BUFFER = 100;

/**
 * Subset of the PolarisDb surface that the SessionManager uses for v0.18.0
 * persistence. Kept as a structural type so tests can inject an in-memory
 * stub without dragging in the full db.ts dependency.
 */
export interface SessionStore {
  upsertAcpSession(row: {
    id: string;
    cwd: string;
    createdAt: number;
    lastActivityAt: number;
    status: string;
    endedAt: number | null;
    endReason: string | null;
    settingsJson: string | null;
  }): void;
  closeAcpSession(id: string, endedAt: number, reason: string): void;
  appendSessionMessage(row: {
    sessionId: string;
    tsMs: number;
    kind: string;
    payloadJson: string;
  }): void;
}

export interface SessionManagerOptions {
  binCmd?: string;
  protocolVersion?: number;
  /** Auto-deny pending approvals not answered within this window. Default 5 min. */
  approvalTimeoutMs?: number;
  /**
   * Optional persistence store. When supplied, the SessionManager writes
   * session lifecycle + every update event into the store. Sessions remain
   * fully functional without a store — v0.18.0 surface is read-only history,
   * resume is not implemented. ADR-0005: opt-in, no abstraction over a
   * single concrete impl yet.
   */
  store?: SessionStore;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

interface IncomingRequest {
  id: JsonRpcId;
  method: string;
  params?: { sessionId?: string; [key: string]: unknown };
}

interface IncomingNotification {
  method: string;
  params?: { sessionId?: string; [key: string]: unknown };
}

interface PendingApprovalInternal extends PendingApproval {
  jsonRpcId: JsonRpcId;
  timer: NodeJS.Timeout;
}

interface InternalSession extends SessionRecord {
  approvals: Map<string, PendingApprovalInternal>;
  listeners: Set<SessionListener>;
}

class SessionManagerImpl implements SessionManager {
  readonly initialized: Promise<void>;
  private readonly handle: AcpProcessHandle;
  private readonly client: AcpJsonRpcClient;
  private readonly sessions = new Map<string, InternalSession>();
  private readonly approvalTimeoutMs: number;
  private readonly failures: SessionFailure[] = [];
  private readonly store: SessionStore | null;
  private closedFlag = false;

  constructor(options: SessionManagerOptions = {}) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.store = options.store ?? null;
    this.handle = spawnAcpProcess(options.binCmd === undefined ? {} : { binCmd: options.binCmd });
    this.client = createAcpJsonRpcClient(this.handle.stdin, this.handle.stdout);
    this.client.on("notification", (msg: IncomingNotification) => this.onNotification(msg));
    this.client.on("request", (msg: IncomingRequest) => this.onServerRequest(msg));
    this.initialized = this.client
      .request("initialize", {
        protocolVersion: options.protocolVersion ?? 1,
        clientCapabilities: {},
      })
      .then(() => undefined);
    this.initialized.catch(() => {});
  }

  private persistSession(rec: InternalSession): void {
    if (this.store === null) return;
    try {
      this.store.upsertAcpSession({
        id: rec.id,
        cwd: rec.cwd,
        createdAt: rec.createdAt,
        lastActivityAt: rec.lastActivityAt,
        status: rec.status,
        endedAt: null,
        endReason: null,
        settingsJson: rec.settings !== undefined ? JSON.stringify(rec.settings) : null,
      });
    } catch {
      // Persistence is best-effort. Never let DB errors break ACP flow.
    }
  }

  private persistMessage(sessionId: string, tsMs: number, kind: string, payload: unknown): void {
    if (this.store === null) return;
    try {
      this.store.appendSessionMessage({
        sessionId,
        tsMs,
        kind,
        payloadJson: JSON.stringify(payload),
      });
    } catch {
      // Best-effort.
    }
  }

  private persistClose(id: string, reason: string): void {
    if (this.store === null) return;
    try {
      this.store.closeAcpSession(id, Date.now(), reason);
    } catch {
      // Best-effort.
    }
  }

  async createSession(opts: CreateSessionOptions): Promise<SessionRecord> {
    if (this.closedFlag) throw new Error("SessionManager is closed");
    await this.initialized;
    // Project settings auto-read (v0.17.0). If the caller did not pass an
    // explicit mcpServers list, load it from <cwd>/.mcp.json (Claude Code
    // convention). Also detect CLAUDE.md and .claude/settings.json for UI
    // visibility — claude-agent-acp itself reads those files based on cwd.
    const projectSettings = readProjectSettings(opts.cwd);
    const mcpFromOpts = Array.isArray(opts.mcpServers) ? opts.mcpServers : null;
    const mcpServers =
      mcpFromOpts !== null
        ? mcpFromOpts
        : projectSettings.mcpServers.map((m) => {
            const out: Record<string, unknown> = { name: m.name, command: m.command };
            if (m.args !== undefined) out.args = m.args;
            if (m.env !== undefined) out.env = m.env;
            return out;
          });
    const res = await this.client.request<{ sessionId: string }>("session/new", {
      cwd: opts.cwd,
      mcpServers,
    });
    const now = Date.now();
    const rec: InternalSession = {
      id: res.sessionId,
      cwd: opts.cwd,
      createdAt: now,
      lastActivityAt: now,
      status: "idle",
      updates: [],
      approvals: new Map(),
      listeners: new Set(),
      settings: settingsToInfo(projectSettings),
    };
    this.sessions.set(rec.id, rec);
    this.persistSession(rec);
    return snapshot(rec);
  }

  async loadSession(id: string, opts: ResumeOptions): Promise<SessionRecord> {
    if (this.closedFlag) throw new Error("SessionManager is closed");
    await this.initialized;
    const existing = this.sessions.get(id);
    if (existing !== undefined) return snapshot(existing);
    // Same project-settings logic as createSession — when resuming a session
    // we still want the same MCP servers + CLAUDE.md / .claude detection
    // reported, in case the on-disk config has changed since the session was
    // originally created.
    const projectSettings = readProjectSettings(opts.cwd);
    const mcpFromOpts = Array.isArray(opts.mcpServers) ? opts.mcpServers : null;
    const mcpServers =
      mcpFromOpts !== null
        ? mcpFromOpts
        : projectSettings.mcpServers.map((m) => {
            const out: Record<string, unknown> = { name: m.name, command: m.command };
            if (m.args !== undefined) out.args = m.args;
            if (m.env !== undefined) out.env = m.env;
            return out;
          });
    // `session/load` may either return { sessionId } or just respond with no
    // body — both shapes are valid ACP. We keep the requested id either way.
    await this.client.request<unknown>("session/load", {
      sessionId: id,
      cwd: opts.cwd,
      mcpServers,
    });
    const now = Date.now();
    const rec: InternalSession = {
      id,
      cwd: opts.cwd,
      createdAt: now,
      lastActivityAt: now,
      status: "idle",
      updates: [],
      approvals: new Map(),
      listeners: new Set(),
      settings: settingsToInfo(projectSettings),
    };
    this.sessions.set(rec.id, rec);
    this.persistSession(rec);
    return snapshot(rec);
  }

  getSession(id: string): SessionRecord | undefined {
    const rec = this.sessions.get(id);
    return rec ? snapshot(rec) : undefined;
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.sessions.values()).map(snapshot);
  }

  async sendPrompt(id: string, text: string, timeoutMs?: number): Promise<PromptResult> {
    if (this.closedFlag) throw new Error("SessionManager is closed");
    const rec = this.sessions.get(id);
    if (!rec) throw new Error(`Unknown session: ${id}`);
    if (rec.status === "closed") throw new Error(`Session ${id} is closed`);
    if (rec.status === "prompting") throw new Error(`Session ${id} is already prompting`);

    rec.status = "prompting";
    const startIdx = rec.updates.length;
    try {
      const res = await this.client.request<{
        stopReason: string;
        usage?: unknown;
        userMessageId?: string;
      }>(
        "session/prompt",
        {
          sessionId: id,
          messageId: randomUUID(),
          prompt: [{ type: "text", text }],
        },
        { timeoutMs: timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS },
      );
      rec.lastActivityAt = Date.now();
      const collected = rec.updates.slice(startIdx);
      const result: PromptResult = {
        stopReason: res.stopReason,
        updates: collected,
      };
      if (res.usage !== undefined) result.usage = res.usage;
      if (res.userMessageId !== undefined) result.userMessageId = res.userMessageId;
      return result;
    } catch (e) {
      this.recordFailure(rec, e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (rec.status === "prompting") rec.status = "idle";
    }
  }

  private recordFailure(rec: InternalSession, reason: string): void {
    this.failures.push({
      sessionId: rec.id,
      cwd: rec.cwd,
      reason,
      atMs: Date.now(),
    });
    while (this.failures.length > MAX_FAILURE_BUFFER) this.failures.shift();
  }

  recentFailures(): SessionFailure[] {
    return this.failures.slice();
  }

  async deleteSession(id: string): Promise<void> {
    const rec = this.sessions.get(id);
    if (!rec) return;
    if (rec.status === "prompting") {
      try {
        this.client.notify("session/cancel", { sessionId: id });
      } catch {
        // Already closed or unreachable — registry cleanup still happens.
      }
    }
    for (const pending of rec.approvals.values()) {
      clearTimeout(pending.timer);
      this.client.respondError(pending.jsonRpcId, -32603, "Session deleted before approval");
    }
    rec.approvals.clear();
    rec.status = "closed";
    this.emit(rec, { type: "session-closed", at: Date.now() });
    rec.listeners.clear();
    this.sessions.delete(id);
    this.persistClose(id, "deleted");
  }

  async close(): Promise<void> {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const rec of this.sessions.values()) {
      for (const pending of rec.approvals.values()) clearTimeout(pending.timer);
      rec.approvals.clear();
      rec.status = "closed";
      this.emit(rec, { type: "session-closed", at: Date.now() });
      rec.listeners.clear();
      this.persistClose(rec.id, "manager-close");
    }
    this.sessions.clear();
    this.client.close();
    await this.handle.close();
  }

  subscribe(sessionId: string, listener: SessionListener): () => void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return () => {};
    rec.listeners.add(listener);
    return () => {
      rec.listeners.delete(listener);
    };
  }

  listApprovals(sessionId: string): PendingApproval[] {
    const rec = this.sessions.get(sessionId);
    if (!rec) return [];
    return Array.from(rec.approvals.values()).map(toPublicApproval);
  }

  getApproval(sessionId: string, approvalId: string): PendingApproval | undefined {
    const pending = this.sessions.get(sessionId)?.approvals.get(approvalId);
    return pending ? toPublicApproval(pending) : undefined;
  }

  respondToApproval(sessionId: string, approvalId: string, response: ApprovalOutcome): boolean {
    const rec = this.sessions.get(sessionId);
    const pending = rec?.approvals.get(approvalId);
    if (!rec || !pending) return false;
    clearTimeout(pending.timer);
    rec.approvals.delete(approvalId);
    this.client.respondResult(pending.jsonRpcId, { outcome: response });
    return true;
  }

  private onNotification(msg: IncomingNotification): void {
    const sid = msg.params?.sessionId;
    if (typeof sid !== "string") return;
    const rec = this.sessions.get(sid);
    if (!rec) return;
    const now = Date.now();
    rec.updates.push({ at: now, payload: msg });
    rec.lastActivityAt = now;
    this.emit(rec, { type: "update", at: now, payload: msg });
    const params = msg.params as { kind?: unknown } | undefined;
    const kind = typeof params?.kind === "string" ? params.kind : "update";
    this.persistMessage(sid, now, kind, msg);
    this.persistSession(rec);
  }

  private onServerRequest(msg: IncomingRequest): void {
    if (msg.method !== "session/request_permission") {
      this.client.respondError(msg.id, -32601, `Method '${msg.method}' is not supported`);
      return;
    }
    const sid = msg.params?.sessionId;
    const rec = typeof sid === "string" ? this.sessions.get(sid) : undefined;
    if (!rec) {
      this.client.respondError(msg.id, -32602, "Unknown sessionId");
      return;
    }
    const approvalId = randomUUID();
    const timer = setTimeout(() => {
      const stillPending = rec.approvals.get(approvalId);
      if (!stillPending) return;
      rec.approvals.delete(approvalId);
      this.client.respondResult(stillPending.jsonRpcId, { outcome: { outcome: "cancelled" } });
    }, this.approvalTimeoutMs);
    const pending: PendingApprovalInternal = {
      approvalId,
      receivedAt: Date.now(),
      method: msg.method,
      params: msg.params,
      jsonRpcId: msg.id,
      timer,
    };
    rec.approvals.set(approvalId, pending);
    rec.lastActivityAt = Date.now();
    this.emit(rec, {
      type: "approval-request",
      at: pending.receivedAt,
      approval: toPublicApproval(pending),
    });
  }

  private emit(rec: InternalSession, event: SessionEvent): void {
    for (const listener of rec.listeners) {
      try {
        listener(event);
      } catch {
        // Listeners are caller-owned; swallow errors so one bad listener
        // can't break the stream for others.
      }
    }
  }
}

function snapshot(rec: InternalSession): SessionRecord {
  const out: SessionRecord = {
    id: rec.id,
    cwd: rec.cwd,
    createdAt: rec.createdAt,
    lastActivityAt: rec.lastActivityAt,
    status: rec.status,
    updates: rec.updates.slice(),
    pendingApprovalsCount: rec.approvals.size,
  };
  if (rec.settings !== undefined) out.settings = rec.settings;
  return out;
}

function toPublicApproval(p: PendingApprovalInternal): PendingApproval {
  return {
    approvalId: p.approvalId,
    receivedAt: p.receivedAt,
    method: p.method,
    params: p.params,
  };
}

export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  return new SessionManagerImpl(options);
}
