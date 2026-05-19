import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSessionManager } from "../acp/session-manager.js";

// Real-binary integration test. Skipped by default — only runs when the
// caller opts in via `POLARIS_REAL_CLAUDE=1`. Requires:
//   - `claude` CLI installed and authenticated (`claude /login`)
//   - The bundled `@agentclientprotocol/claude-agent-acp` binary resolvable
//     via Node module resolution (it is, after `npm install`)
//   - Anthropic credits (real LLM tokens are burned)
//
// See docs/integration-testing.md for the full runbook.
const enabled = process.env.POLARIS_REAL_CLAUDE === "1";

describe.skipIf(!enabled)("real claude-agent-acp", () => {
  it("initialize → newSession → prompt round-trips with the real binary", async () => {
    const mgr = createSessionManager();
    try {
      const session = await mgr.createSession({ cwd: tmpdir() });
      expect(session.id).toBeTruthy();
      expect(session.status).toBe("idle");

      // Tight prompt that should not need any tool use, so no
      // permission requests are issued. 60s upper bound is generous
      // for a single one-word completion.
      // 2-min cap on the prompt itself — generous for cold-start cases
      // where the SDK has to do its first auth/init handshake.
      const result = await mgr.sendPrompt(
        session.id,
        "Reply with exactly the word: hello",
        120_000,
      );
      expect(result.stopReason).toBe("end_turn");
      // The agent emits at least one update (the agent_message) before
      // the prompt response, regardless of model.
      expect(result.updates.length).toBeGreaterThan(0);
    } finally {
      await mgr.close();
    }
  }, 180_000);
});
