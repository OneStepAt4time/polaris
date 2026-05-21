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

export interface SessionManager {
  createSession(opts: CreateSessionOptions): Promise<SessionRecord>;
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

export interface SessionManagerOptions {
  binCmd?: string;
  protocolVersion?: number;
  /** Auto-deny pending approvals not answered within this window. Default 5 min. */
  approvalTimeoutMs?: number;
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
  private closedFlag = false;

  constructor(options: SessionManagerOptions = {}) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
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
