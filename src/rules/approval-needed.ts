import type { RuleMatch } from "./cost-threshold.js";

export interface PendingApprovalInfo {
  sessionId: string;
  cwd: string;
  approvalId: string;
  receivedAt: number;
  toolName: string;
}

export interface ApprovalNeededConfig {
  approvalsSource: () => PendingApprovalInfo[];
}

const RULE_PREFIX = "approval-needed";

export function checkApprovalNeeded(cfg: ApprovalNeededConfig): RuleMatch[] {
  const approvals = cfg.approvalsSource();
  return approvals.map((a) => {
    const id = a.sessionId.slice(0, 12);
    const cwd = truncate(a.cwd, 80);
    const tool = truncate(a.toolName, 100);
    const message = `*Polaris* — approval needed\n\nSession: \`${id}\`\ncwd: \`${cwd}\`\nTool: \`${tool}\``;
    return {
      ruleName: `${RULE_PREFIX}:${a.sessionId}`,
      dedupKey: a.approvalId,
      message,
      // v0.35.0 — let inline-capable channels (Telegram) render Allow/Deny
      // buttons. correlationId encodes both ids so the channel poller can
      // route the callback without a separate lookup table. optionId values
      // ("allow_once", "reject_once") mirror what the ACP child uses on
      // `session/request_permission`.
      inlineActions: [
        { id: "allow_once", label: "✓ Allow" },
        { id: "reject_once", label: "✕ Deny" },
      ],
      correlationId: `${a.sessionId}:${a.approvalId}`,
    };
  });
}

/**
 * Best-effort tool name extraction from the raw ACP params object.
 * Real claude-agent-acp uses `toolUse.name`; older/other shapes may use
 * `toolCall.title`, `toolCall.toolName`, or `toolCall.kind`.
 */
export function extractToolName(params: unknown): string {
  if (!isObject(params)) return "unknown";
  const tu = (params as Record<string, unknown>).toolUse;
  if (isObject(tu)) {
    const n = (tu as Record<string, unknown>).name;
    if (typeof n === "string" && n.length > 0) return n;
  }
  const tc = (params as Record<string, unknown>).toolCall;
  if (isObject(tc)) {
    const r = tc as Record<string, unknown>;
    for (const k of ["title", "toolName", "kind"]) {
      const v = r[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return "unknown";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
