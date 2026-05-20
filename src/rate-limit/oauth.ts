import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  subscriptionType?: string;
}

export function defaultCredentialsPath(): string {
  return resolve(homedir(), ".claude", ".credentials.json");
}

/**
 * Read Claude Code's OAuth credentials from disk. Returns null when the file
 * is missing, unreadable, or malformed — callers should treat null as
 * "rate-limit polling disabled" rather than as a hard error, because Polaris
 * is fully functional without OAuth (just without the rate-limit view).
 */
export function loadOAuthCredentials(
  path: string = defaultCredentialsPath(),
): OAuthCredentials | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const oauth = root.claudeAiOauth;
  if (typeof oauth !== "object" || oauth === null) return null;
  const o = oauth as Record<string, unknown>;
  const accessToken = typeof o.accessToken === "string" ? o.accessToken : null;
  if (accessToken === null || accessToken === "") return null;
  const result: OAuthCredentials = { accessToken };
  if (typeof o.refreshToken === "string") result.refreshToken = o.refreshToken;
  if (typeof o.expiresAt === "string") {
    const parsedTs = Date.parse(o.expiresAt);
    if (Number.isFinite(parsedTs)) result.expiresAtMs = parsedTs;
  } else if (typeof o.expiresAt === "number" && Number.isFinite(o.expiresAt)) {
    result.expiresAtMs = o.expiresAt;
  }
  if (typeof o.subscriptionType === "string") result.subscriptionType = o.subscriptionType;
  return result;
}
