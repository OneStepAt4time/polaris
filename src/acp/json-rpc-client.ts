import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface RequestOptions {
  timeoutMs?: number;
}

/**
 * Minimal JSON-RPC 2.0 client over an arbitrary stdin/stdout pair. ACP uses
 * newline-delimited framing — one JSON object per line.
 *
 * Emits:
 *  - "notification" with the raw `JsonRpcNotification` (method-without-id)
 *  - "request"      with the raw `JsonRpcRequest`      (method-with-id from server, e.g. session/request_permission)
 *  - "parseError"   with the offending line when a non-JSON line arrives
 *  - "closed"       fired once when the underlying stream closes
 *
 * Pending `request()` promises reject when the stream closes.
 *
 * No driver control, no restart, no in-memory message queue.
 * If the stream dies, the client dies (ADR-0010 trap exclusion).
 */
export interface AcpJsonRpcClient extends EventEmitter {
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>;
  notify(method: string, params?: unknown): void;
  /** Reply to a server-initiated request with a success result. */
  respondResult(id: JsonRpcId, result: unknown): void;
  /** Reply to a server-initiated request with an error. */
  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void;
  /** Mark closed; reject all pending; doesn't close the underlying streams (caller owns them). */
  close(): void;
  /** Resolves once `close()` is called or the stream closes itself. */
  readonly closed: Promise<void>;
}

class AcpJsonRpcClientImpl extends EventEmitter implements AcpJsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer?: NodeJS.Timeout;
    }
  >();
  private buffer = "";
  private closedFlag = false;
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
  ) {
    super();
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    if (typeof stdout.setEncoding === "function") {
      stdout.setEncoding("utf8");
    }
    stdout.on("data", (chunk: string | Buffer) => {
      this.onData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    stdout.once("close", () => this.shutdown("stdout closed"));
    stdout.once("error", (err) => this.shutdown(`stdout error: ${err.message}`));
  }

  request<T = unknown>(method: string, params?: unknown, options: RequestOptions = {}): Promise<T> {
    if (this.closedFlag) {
      return Promise.reject(new Error("AcpJsonRpcClient is closed"));
    }
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const entry: {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        timer?: NodeJS.Timeout;
      } = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      if (options.timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request ${method} (id=${id}) timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      }
      this.pending.set(id, entry);
      this.stdin.write(`${JSON.stringify(msg)}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closedFlag) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  respondResult(id: JsonRpcId, result: unknown): void {
    if (this.closedFlag) return;
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result };
    this.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    if (this.closedFlag) return;
    const error = data === undefined ? { code, message } : { code, message, data };
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error };
    this.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  close(): void {
    this.shutdown("client.close() called");
  }

  private onData(text: string): void {
    this.buffer += text;
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line === "") continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.emit("parseError", line);
      return;
    }
    if (!isObject(msg)) return;

    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const id = msg.id as JsonRpcId;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      const err = (msg as unknown as JsonRpcResponse).error;
      if (err) {
        pending.reject(new Error(`JSON-RPC error ${err.code}: ${err.message}`));
      } else {
        pending.resolve((msg as unknown as JsonRpcResponse).result);
      }
      return;
    }

    if ("method" in msg) {
      if ("id" in msg) {
        this.emit("request", msg);
      } else {
        this.emit("notification", msg);
      }
    }
  }

  private shutdown(reason: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.emit("closed");
    this.resolveClosed();
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function createAcpJsonRpcClient(stdin: Writable, stdout: Readable): AcpJsonRpcClient {
  return new AcpJsonRpcClientImpl(stdin, stdout);
}
