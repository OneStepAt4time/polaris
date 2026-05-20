import type { SessionFailure } from "../acp/session-manager.js";
import type { RuleMatch } from "./cost-threshold.js";

export interface SessionFailedConfig {
  failuresSource: () => SessionFailure[];
}

const RULE_PREFIX = "session-failed";

export function checkSessionFailed(cfg: SessionFailedConfig): RuleMatch[] {
  const failures = cfg.failuresSource();
  return failures.map((f) => {
    const id = f.sessionId.slice(0, 12);
    const cwd = truncate(f.cwd, 80);
    const reason = truncate(f.reason, 200);
    const message = `*Polaris* — session failed\n\nSession: \`${id}\`\ncwd: \`${cwd}\`\nReason: \`${reason}\``;
    return {
      ruleName: `${RULE_PREFIX}:${f.sessionId}`,
      dedupKey: String(f.atMs),
      message,
    };
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
