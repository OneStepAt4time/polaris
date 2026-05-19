import { randomUUID } from "node:crypto";
import {
  type AcpJsonRpcClient,
  type JsonRpcId,
  createAcpJsonRpcClient,
} from "./json-rpc-client.js";
import { type AcpProcessHandle, spawnAcpProcess } from "./spawner.js";

export type SessionStatus = "idle" | "prompting" | "closed";

export interface SessionUpdate {
  at: number;
  payload: unknown;
}

export interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  status: SessionStatus;
  updates: SessionUpdate[];
}

export interface CreateSessionOptions {
  cwd: string;
  mcpServers?: unknown[];
}

export interface PromptResult {
  stopReason: string;
  updates: SessionUpdate[];
  usage?: unknown;
  userMessageId?: string;
}

export interface SessionManager {
  createSession(opts: CreateSessionOptions): Promise<SessionRecord>;
  getSession(id: string): SessionRecord | undefined;
  listSessions(): SessionRecord[];
  sendPrompt(id: string, text: string, timeoutMs?: number): Promise<PromptResult>;
  deleteSession(id: string): Promise<void>;
  close(): Promise<void>;
  readonly initialized: Promise<void>;
}

export interface SessionManagerOptions {
  binCmd?: string;
  protocolVersion?: number;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

interface IncomingRequest {
  id: JsonRpcId;
  method: string;
  params?: { sessionId?: string; [key: string]: unknown };
}

interface IncomingNotification {
  method: string;
  params?: { sessionId?: string; [key: string]: unknown };
}

class SessionManagerImpl implements SessionManager {
  readonly initialized: Promise<void>;
  private readonly handle: AcpProcessHandle;
  private readonly client: AcpJsonRpcClient;
  private readonly sessions = new Map<string, SessionRecord>();
  private closedFlag = false;

  constructor(options: SessionManagerOptions = {}) {
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
    // Pre-attach a no-op handler so an early rejection (manager closed before
    // anyone awaits this promise) doesn't trigger Node's unhandledRejection.
    this.initialized.catch(() => {});
  }

  async createSession(opts: CreateSessionOptions): Promise<SessionRecord> {
    if (this.closedFlag) throw new Error("SessionManager is closed");
    await this.initialized;
    const res = await this.client.request<{ sessionId: string }>("session/new", {
      cwd: opts.cwd,
      mcpServers: opts.mcpServers ?? [],
    });
    const now = Date.now();
    const rec: SessionRecord = {
      id: res.sessionId,
      cwd: opts.cwd,
      createdAt: now,
      lastActivityAt: now,
      status: "idle",
      updates: [],
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
    } finally {
      if (rec.status === "prompting") rec.status = "idle";
    }
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
    rec.status = "closed";
    this.sessions.delete(id);
  }

  async close(): Promise<void> {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const rec of this.sessions.values()) rec.status = "closed";
    this.sessions.clear();
    this.client.close();
    await this.handle.close();
  }

  private onNotification(msg: IncomingNotification): void {
    const sid = msg.params?.sessionId;
    if (typeof sid !== "string") return;
    const rec = this.sessions.get(sid);
    if (!rec) return;
    rec.updates.push({ at: Date.now(), payload: msg });
    rec.lastActivityAt = Date.now();
  }

  // ACP-C (v0.5) wires the approval surface. Until then any server-initiated
  // request is auto-denied with a MethodNotFound-shaped error so the agent
  // doesn't hang waiting for a response.
  private onServerRequest(msg: IncomingRequest): void {
    this.client.respondError(
      msg.id,
      -32601,
      `Polaris does not yet handle '${msg.method}' (waiting on ACP-C / v0.5)`,
    );
  }
}

function snapshot(rec: SessionRecord): SessionRecord {
  return {
    id: rec.id,
    cwd: rec.cwd,
    createdAt: rec.createdAt,
    lastActivityAt: rec.lastActivityAt,
    status: rec.status,
    updates: rec.updates.slice(),
  };
}

export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  return new SessionManagerImpl(options);
}
