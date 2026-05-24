import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProjectSettings } from "../acp/project-settings.js";

describe("readProjectSettings", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(resolve(tmpdir(), "polaris-ps-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns null paths + empty mcpServers when no files exist", () => {
    const s = readProjectSettings(cwd);
    expect(s.cwd).toBe(cwd);
    expect(s.claudeMdPath).toBeNull();
    expect(s.claudeSettingsPath).toBeNull();
    expect(s.mcpServers).toEqual([]);
    expect(s.warnings).toEqual([]);
  });

  it("detects CLAUDE.md when present", () => {
    writeFileSync(resolve(cwd, "CLAUDE.md"), "# Project rules\n");
    const s = readProjectSettings(cwd);
    expect(s.claudeMdPath).toBe(resolve(cwd, "CLAUDE.md"));
  });

  it("detects .claude/settings.json when present", () => {
    mkdirSync(resolve(cwd, ".claude"));
    writeFileSync(resolve(cwd, ".claude", "settings.json"), "{}");
    const s = readProjectSettings(cwd);
    expect(s.claudeSettingsPath).toBe(resolve(cwd, ".claude", "settings.json"));
  });

  it("parses mcpServers from .mcp.json into the Polaris spec shape", () => {
    writeFileSync(
      resolve(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          fs: { command: "uvx", args: ["mcp-server-filesystem", "/tmp"] },
          dbg: { command: "node", args: ["debug.mjs"], env: { TZ: "UTC", DEBUG: "1" } },
        },
      }),
    );
    const s = readProjectSettings(cwd);
    expect(s.mcpServers).toHaveLength(2);
    const fs = s.mcpServers.find((m) => m.name === "fs");
    expect(fs?.command).toBe("uvx");
    expect(fs?.args).toEqual(["mcp-server-filesystem", "/tmp"]);
    const dbg = s.mcpServers.find((m) => m.name === "dbg");
    expect(dbg?.env).toEqual({ TZ: "UTC", DEBUG: "1" });
  });

  it("skips servers without command and records a warning", () => {
    writeFileSync(
      resolve(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          good: { command: "node" },
          bad: { args: ["no", "command"] },
        },
      }),
    );
    const s = readProjectSettings(cwd);
    expect(s.mcpServers.map((m) => m.name)).toEqual(["good"]);
    expect(s.warnings.join("\n")).toMatch(/"bad".*no command/);
  });

  it("returns empty + warning on malformed .mcp.json (does not throw)", () => {
    writeFileSync(resolve(cwd, ".mcp.json"), "not json");
    const s = readProjectSettings(cwd);
    expect(s.mcpServers).toEqual([]);
    expect(s.warnings.join("\n")).toMatch(/failed to parse/);
  });

  it("returns empty when .mcp.json has no top-level mcpServers key", () => {
    writeFileSync(resolve(cwd, ".mcp.json"), JSON.stringify({ other: "field" }));
    const s = readProjectSettings(cwd);
    expect(s.mcpServers).toEqual([]);
    expect(s.warnings).toEqual([]);
  });

  it("v0.26.0: detects AGENTS.md alongside CLAUDE.md", () => {
    writeFileSync(resolve(cwd, "AGENTS.md"), "# agents\n");
    const s = readProjectSettings(cwd);
    expect(s.agentsMdPath).toBe(resolve(cwd, "AGENTS.md"));
    expect(s.claudeMdPath).toBeNull();
  });

  it("v0.26.0: detects .claude/settings.local.json separately from settings.json", () => {
    mkdirSync(resolve(cwd, ".claude"));
    writeFileSync(resolve(cwd, ".claude", "settings.local.json"), "{}");
    const s = readProjectSettings(cwd);
    expect(s.claudeSettingsLocalPath).toBe(resolve(cwd, ".claude", "settings.local.json"));
    expect(s.claudeSettingsPath).toBeNull();
  });

  it("v0.26.0: deep-merges settings.local.json over settings.json and resolves the model", () => {
    mkdirSync(resolve(cwd, ".claude"));
    writeFileSync(
      resolve(cwd, ".claude", "settings.json"),
      JSON.stringify({
        model: "claude-sonnet-4-6",
        permissions: { allow: ["Bash(npm:*)"], deny: ["Bash(rm:*)"] },
        hooks: { PreToolUse: [{}] },
      }),
    );
    writeFileSync(
      resolve(cwd, ".claude", "settings.local.json"),
      JSON.stringify({
        model: "claude-opus-4-7",
        permissions: { allow: ["Read(./src/*)"] },
      }),
    );
    const s = readProjectSettings(cwd);
    expect(s.settings?.model).toBe("claude-opus-4-7");
    // permissions.allow deep-merged: local replaces base entirely for the
    // allow array (overlay value wins for non-object types).
    expect(s.settings?.permissionsAllow).toBe(1);
    expect(s.settings?.permissionsDeny).toBe(1);
    expect(s.settings?.hookEvents).toEqual(["PreToolUse"]);
  });

  it("v0.26.0: lists slash commands / agents / skills / output-styles by name", () => {
    const claudeDir = resolve(cwd, ".claude");
    mkdirSync(claudeDir);
    mkdirSync(resolve(claudeDir, "commands"));
    writeFileSync(resolve(claudeDir, "commands", "deploy.md"), "# deploy");
    writeFileSync(resolve(claudeDir, "commands", "lint.md"), "# lint");
    mkdirSync(resolve(claudeDir, "agents"));
    writeFileSync(resolve(claudeDir, "agents", "reviewer.md"), "# reviewer");
    mkdirSync(resolve(claudeDir, "skills"));
    mkdirSync(resolve(claudeDir, "skills", "do-thing"));
    writeFileSync(resolve(claudeDir, "skills", "do-thing", "SKILL.md"), "# skill");
    // A skills dir without SKILL.md must be ignored.
    mkdirSync(resolve(claudeDir, "skills", "incomplete"));
    mkdirSync(resolve(claudeDir, "output-styles"));
    writeFileSync(resolve(claudeDir, "output-styles", "concise.md"), "# style");
    const s = readProjectSettings(cwd);
    expect(s.commands).toEqual(["deploy", "lint"]);
    expect(s.agents).toEqual(["reviewer"]);
    expect(s.skills).toEqual(["do-thing"]);
    expect(s.outputStyles).toEqual(["concise"]);
  });

  it("v0.26.0: surfaces apiKeyHelperSet + envSet without leaking values", () => {
    mkdirSync(resolve(cwd, ".claude"));
    writeFileSync(
      resolve(cwd, ".claude", "settings.json"),
      JSON.stringify({
        apiKeyHelper: "/usr/local/bin/get-key",
        env: { ANTHROPIC_BASE_URL: "https://proxy.internal" },
      }),
    );
    const s = readProjectSettings(cwd);
    expect(s.settings?.apiKeyHelperSet).toBe(true);
    expect(s.settings?.envSet).toBe(true);
    // The raw values must NOT be in the public structure.
    const serialised = JSON.stringify(s.settings);
    expect(serialised).not.toContain("/usr/local/bin/get-key");
    expect(serialised).not.toContain("proxy.internal");
  });
});
