import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * Structural summary of `.claude/settings.json` + `.claude/settings.local.json`
 * deep-merged together (local wins). v0.26.0. We surface counts and the
 * resolved model only — raw values that might contain secrets (apiKeyHelper
 * output, env values) are NOT exposed here.
 */
export interface SettingsSummary {
  /** Resolved Anthropic model id, or null when settings don't override it. */
  model: string | null;
  /** Resolved output style name, or null. */
  outputStyle: string | null;
  /** Count of permissions.allow rules. */
  permissionsAllow: number;
  /** Count of permissions.deny rules. */
  permissionsDeny: number;
  /** Names of the top-level hook event keys (PreToolUse, Stop, …). */
  hookEvents: string[];
  /** Count of additionalDirectories entries. */
  additionalDirectories: number;
  /** Does the resolved settings include an apiKeyHelper override? */
  apiKeyHelperSet: boolean;
  /** Does the resolved settings include any env overrides? */
  envSet: boolean;
}

export interface ProjectSettings {
  /** Absolute cwd these settings were resolved against. */
  cwd: string;
  /** Path to CLAUDE.md if it exists in cwd. */
  claudeMdPath: string | null;
  /** Path to AGENTS.md if it exists in cwd. v0.26.0. */
  agentsMdPath: string | null;
  /** Path to .claude/settings.json if it exists. */
  claudeSettingsPath: string | null;
  /** Path to .claude/settings.local.json if it exists. v0.26.0. */
  claudeSettingsLocalPath: string | null;
  /** Servers loaded from `<cwd>/.mcp.json`. */
  mcpServers: McpServerSpec[];
  /** Slash-command file names (without .md) under .claude/commands/. v0.26.0. */
  commands: string[];
  /** Subagent file names (without .md) under .claude/agents/. v0.26.0. */
  agents: string[];
  /** Skill names (parent dir of SKILL.md) under .claude/skills/. v0.26.0. */
  skills: string[];
  /** Output-style file names (without .md) under .claude/output-styles/. v0.26.0. */
  outputStyles: string[];
  /**
   * Settings.json + settings.local.json deep-merged + summarised. null when
   * neither file exists. v0.26.0.
   */
  settings: SettingsSummary | null;
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

function dirExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJsonFile(path: string, warnings: string[]): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    warnings.push(`failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    warnings.push(`failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function parseMcpFile(path: string, warnings: string[]): McpServerSpec[] {
  const parsed = readJsonFile(path, warnings);
  if (parsed === null || typeof parsed !== "object") return [];
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

function listMdNames(dir: string): string[] {
  if (!dirExists(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

function listSkillNames(dir: string): string[] {
  if (!dirExists(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fileExists(resolve(dir, entry.name, "SKILL.md")))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(overlay)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(overlay)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return overlay === undefined ? base : overlay;
}

function summariseSettings(merged: Record<string, unknown> | null): SettingsSummary | null {
  if (merged === null) return null;
  const model = typeof merged.model === "string" ? merged.model : null;
  const outputStyle = typeof merged.outputStyle === "string" ? merged.outputStyle : null;
  const perms = isPlainObject(merged.permissions) ? merged.permissions : null;
  const permsAllow = perms && Array.isArray(perms.allow) ? perms.allow.length : 0;
  const permsDeny = perms && Array.isArray(perms.deny) ? perms.deny.length : 0;
  const hooks = isPlainObject(merged.hooks) ? merged.hooks : null;
  const hookEvents = hooks ? Object.keys(hooks).sort() : [];
  const addDirs = Array.isArray(merged.additionalDirectories)
    ? merged.additionalDirectories.length
    : 0;
  return {
    model,
    outputStyle,
    permissionsAllow: permsAllow,
    permissionsDeny: permsDeny,
    hookEvents,
    additionalDirectories: addDirs,
    apiKeyHelperSet: typeof merged.apiKeyHelper === "string" && merged.apiKeyHelper !== "",
    envSet: isPlainObject(merged.env) && Object.keys(merged.env).length > 0,
  };
}

/**
 * Read Claude Code-style project settings from a working directory. Mirrors
 * the conventions `claude` follows when launched in a project root:
 * - CLAUDE.md, AGENTS.md (memory; read by the agent — Polaris just reports
 *   presence).
 * - .claude/settings.json + .claude/settings.local.json (read by the agent;
 *   Polaris also deep-merges them and surfaces a structural summary —
 *   resolved model, permissions counts, hook event names. No secret values
 *   are exposed).
 * - .mcp.json (Polaris parses + forwards to ACP session/new).
 * - .claude/commands/*.md, .claude/agents/*.md, .claude/skills/<name>/SKILL.md,
 *   .claude/output-styles/*.md (Polaris reports the names so the UI can show
 *   what's wired up).
 *
 * Non-fatal failures land in `warnings`; the function never throws on missing
 * or malformed files. v0.26.0.
 */
export function readProjectSettings(cwd: string): ProjectSettings {
  const warnings: string[] = [];
  const claudeMdPath = resolve(cwd, "CLAUDE.md");
  const agentsMdPath = resolve(cwd, "AGENTS.md");
  const claudeDir = resolve(cwd, ".claude");
  const settingsPath = resolve(claudeDir, "settings.json");
  const settingsLocalPath = resolve(claudeDir, "settings.local.json");
  const mcpPath = resolve(cwd, ".mcp.json");

  const mcpServers = fileExists(mcpPath) ? parseMcpFile(mcpPath, warnings) : [];

  let mergedSettings: Record<string, unknown> | null = null;
  if (fileExists(settingsPath)) {
    const base = readJsonFile(settingsPath, warnings);
    if (isPlainObject(base)) mergedSettings = base;
  }
  if (fileExists(settingsLocalPath)) {
    const overlay = readJsonFile(settingsLocalPath, warnings);
    if (isPlainObject(overlay)) {
      mergedSettings = isPlainObject(mergedSettings)
        ? (deepMerge(mergedSettings, overlay) as Record<string, unknown>)
        : overlay;
    }
  }

  return {
    cwd,
    claudeMdPath: fileExists(claudeMdPath) ? claudeMdPath : null,
    agentsMdPath: fileExists(agentsMdPath) ? agentsMdPath : null,
    claudeSettingsPath: fileExists(settingsPath) ? settingsPath : null,
    claudeSettingsLocalPath: fileExists(settingsLocalPath) ? settingsLocalPath : null,
    mcpServers,
    commands: listMdNames(resolve(claudeDir, "commands")),
    agents: listMdNames(resolve(claudeDir, "agents")),
    skills: listSkillNames(resolve(claudeDir, "skills")),
    outputStyles: listMdNames(resolve(claudeDir, "output-styles")),
    settings: summariseSettings(mergedSettings),
    warnings,
  };
}
