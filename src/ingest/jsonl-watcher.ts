import { type FSWatcher, existsSync, watch as fsWatch } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { PolarisDb } from "../db.js";
import { ingest } from "./ingest.js";

export interface WatcherHandle {
  close: () => void;
}

export interface WatcherOptions {
  /** Debounce window per file before re-parsing. Default 500ms. */
  debounceMs?: number;
  /** Logger hook (defaults to silent). */
  log?: (msg: string) => void;
}

/**
 * Watch `rootPath` recursively for changes to *.jsonl files and re-ingest each
 * touched file. DB-level INSERT OR IGNORE handles cross-call dedup so a naive
 * "re-parse on any change" is correct (just slightly redundant for streams).
 *
 * Returns a handle whose `close()` stops watching and clears pending debounces.
 *
 * Gracefully returns a no-op handle if `rootPath` doesn't exist — running
 * Polaris on a machine that hasn't installed Claude Code yet is supported.
 *
 * Path strings starting with "~/" are expanded against `os.homedir()`.
 */
export function startWatcher(
  rootPath: string,
  db: PolarisDb,
  options: WatcherOptions = {},
): WatcherHandle {
  const expanded = expandHome(rootPath);
  if (!existsSync(expanded)) {
    options.log?.(`[watcher] path does not exist, skipping: ${expanded}`);
    return { close: () => {} };
  }

  const debounceMs = options.debounceMs ?? 500;
  const debouncers = new Map<string, NodeJS.Timeout>();

  const reparse = async (relPath: string): Promise<void> => {
    const absPath = join(expanded, relPath);
    let content: string;
    try {
      content = await readFile(absPath, "utf8");
    } catch {
      // File may have been deleted between event and read; that's expected.
      return;
    }
    ingest(db, relPath.replace(/\\/g, "/"), content);
  };

  let watcher: FSWatcher;
  try {
    watcher = fsWatch(expanded, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const normalized = filename.toString();
      if (!normalized.endsWith(".jsonl")) return;

      const existing = debouncers.get(normalized);
      if (existing) clearTimeout(existing);
      debouncers.set(
        normalized,
        setTimeout(() => {
          debouncers.delete(normalized);
          void reparse(normalized);
        }, debounceMs),
      );
    });
  } catch (err) {
    options.log?.(`[watcher] fs.watch failed (recursive may be unsupported): ${String(err)}`);
    return { close: () => {} };
  }

  return {
    close: (): void => {
      for (const timer of debouncers.values()) clearTimeout(timer);
      debouncers.clear();
      watcher.close();
    },
  };
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** Exported only for tests. */
export const _expandHome = expandHome;

/** Exported only for tests — relative path helper used by tests to construct expected sessionFile. */
export function relativeWatched(rootPath: string, absPath: string): string {
  return relative(expandHome(rootPath), absPath).replace(/\\/g, "/");
}
