import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";

export interface AcpProcessHandle {
  readonly pid: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Resolves with the exit code (or null on signal) when the child terminates. */
  readonly exit: Promise<number | null>;
  /** Send SIGTERM, then SIGKILL after a grace period if still alive. Idempotent. */
  close: () => Promise<void>;
}

export interface AcpSpawnOptions {
  /**
   * Command to spawn. If empty or undefined, locates the bundled
   * `@agentclientprotocol/claude-agent-acp` via Node module resolution.
   * Tests override this with a fixture script invocation.
   * Parsed with naive whitespace splitting — no shell quoting.
   */
  binCmd?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const KILL_GRACE_MS = 2000;

/**
 * Spawn the ACP child process and expose its stdio streams. The caller composes
 * a JSON-RPC client over `stdin`/`stdout` (see ./json-rpc-client.ts). Errors
 * surfacing on the child's stderr are passed through; treat them as informational
 * unless the process exits non-zero.
 *
 * Lifecycle is single-shot. No restart, no backoff (ADR-0010 trap exclusion).
 * If the child crashes, the caller's `request()` calls reject with a stream-closed
 * error and the caller decides whether to spawn again from scratch.
 */
export function spawnAcpProcess(options: AcpSpawnOptions = {}): AcpProcessHandle {
  const trimmed = options.binCmd?.trim() ?? "";
  const { cmd, args } = trimmed === "" ? defaultBin() : splitCommand(trimmed);

  const child: ChildProcess = spawn(cmd, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error(`ACP child '${cmd}' spawned without piped stdio`);
  }

  // Surface 'error' (e.g. ENOENT for a missing binary) through the exit
  // promise rather than letting it bubble as an uncaught exception.
  let resolveExit!: (code: number | null) => void;
  let rejectExit!: (err: Error) => void;
  const exit = new Promise<number | null>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  // Pre-attach a no-op handler so an early rejection (before any consumer
  // attaches .then/.catch) doesn't trigger Node's unhandledRejection.
  exit.catch(() => {});
  child.once("exit", (code) => resolveExit(code));
  child.once("error", (err) => rejectExit(err as Error));

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // Already dead or never started — race condition, ignore.
      }
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, KILL_GRACE_MS);
      try {
        await exit;
      } catch {
        // Exit rejected (spawn error) — that's also "done".
      } finally {
        clearTimeout(timer);
      }
    })();
    return closing;
  };

  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit,
    close,
  };
}

/**
 * Shell-like split: whitespace-separated tokens, with " and ' supported to
 * keep paths-with-spaces intact (essential on Windows where node lives at
 * `C:\Program Files\nodejs\node.exe`). No backslash escaping; for that, use
 * the programmatic API of spawn directly.
 */
function splitCommand(s: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let cur = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] as string;
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (cur !== "") {
        parts.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== "") parts.push(cur);
  if (parts.length === 0) throw new Error("Empty bin command");
  return { cmd: parts[0] as string, args: parts.slice(1) };
}

function defaultBin(): { cmd: string; args: string[] } {
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve("@agentclientprotocol/claude-agent-acp/package.json");
    const pkg = req(pkgPath) as { bin?: Record<string, string> };
    const binEntry = pkg.bin?.["claude-agent-acp"];
    if (binEntry) {
      return { cmd: process.execPath, args: [join(dirname(pkgPath), binEntry)] };
    }
  } catch {
    // Package not installed or resolution failed. Fall through to PATH lookup.
  }
  return { cmd: "claude-agent-acp", args: [] };
}
