import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface McpServerSpec {
  /** Logical name of the server (key in `.mcp.json` `mcpServers`). */
  name: string;
  /** Executable command. Required. */
  command: string;
  /** Command arguments. Defaults to empty. */
  args?: string[];
  /** Environment variables. Defaults to empty. */
  env?: Record<string, string>;
}

export interface ProjectSettings {
  /** Absolute cwd these settings were resolved against. */
  cwd: string;
  /** Path to CLAUDE.md if it exists in cwd. */
  claudeMdPath: string | null;
  /** Path to .claude/settings.json if it exists. */
  claudeSettingsPath: string | null;
  /** Servers loaded from `<cwd>/.mcp.json`. */
  mcpServers: McpServerSpec[];
  /** Non-fatal warnings (parse errors etc.). */
  warnings: string[];
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function parseMcpFile(path: string, warnings: string[]): McpServerSpec[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    warnings.push(`failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    warnings.push(`failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const root = parsed as Record<string, unknown>;
  const servers = root.mcpServers;
  if (typeof servers !== "object" || servers === null) return [];
  const out: McpServerSpec[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.command !== "string" || e.command === "") {
      warnings.push(`mcp server "${name}" in ${path} has no command — skipped`);
      continue;
    }
    const spec: McpServerSpec = { name, command: e.command };
    if (Array.isArray(e.args) && e.args.every((a) => typeof a === "string")) {
      spec.args = e.args as string[];
    }
    if (e.env !== null && typeof e.env === "object") {
      const envEntries = Object.entries(e.env as Record<string, unknown>).filter(
        (kv): kv is [string, string] => typeof kv[1] === "string",
      );
      if (envEntries.length > 0) spec.env = Object.fromEntries(envEntries);
    }
    out.push(spec);
  }
  return out;
}

/**
 * Read Claude Code-style project settings from a working directory. Mirrors
 * the conventions `claude` follows when launched in a project root:
 * - CLAUDE.md (read by the agent as context — Polaris just reports presence)
 * - .claude/settings.json (read by the agent — Polaris just reports presence)
 * - .mcp.json (mcpServers list — Polaris parses + forwards to ACP session/new)
 *
 * Non-fatal failures land in `warnings`; the function never throws on missing
 * or malformed files.
 */
export function readProjectSettings(cwd: string): ProjectSettings {
  const warnings: string[] = [];
  const claudeMdPath = resolve(cwd, "CLAUDE.md");
  const claudeSettingsPath = resolve(cwd, ".claude", "settings.json");
  const mcpPath = resolve(cwd, ".mcp.json");
  const mcpServers = fileExists(mcpPath) ? parseMcpFile(mcpPath, warnings) : [];
  return {
    cwd,
    claudeMdPath: fileExists(claudeMdPath) ? claudeMdPath : null,
    claudeSettingsPath: fileExists(claudeSettingsPath) ? claudeSettingsPath : null,
    mcpServers,
    warnings,
  };
}
