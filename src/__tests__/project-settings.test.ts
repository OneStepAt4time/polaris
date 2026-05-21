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
});
