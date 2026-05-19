# Integration testing — real claude-agent-acp

The default `npm test` gate runs against a mock ACP fixture
(`src/__tests__/fixtures/acp-mock-server.mjs`). The fixture proves the
protocol shape but does not prove interoperability with the real
`@agentclientprotocol/claude-agent-acp` binary, which under the hood
spawns a real `claude` CLI session and burns real Anthropic tokens.

To validate the wire end-to-end you run a single env-gated test:

```bash
POLARIS_REAL_CLAUDE=1 npx vitest run src/__tests__/real-claude.integration.test.ts
```

Prerequisites:

1. `claude` CLI installed (`npm i -g @anthropic-ai/claude-code` or platform
   installer) and authenticated (`claude /login`).
2. `npm install` has run in the working tree so the bundled
   `@agentclientprotocol/claude-agent-acp` binary is resolvable.
3. Anthropic account with credits — the test sends a one-word prompt to
   the default model, so the cost is sub-cent, but it is **not** zero.

The test asserts:

- The bundled binary spawns successfully via `spawnAcpProcess()`.
- `initialize` round-trips.
- `session/new` returns a session id.
- `session/prompt` for `"Reply with exactly the word: hello"` completes
  with `stopReason === "end_turn"` and at least one update notification.

It does **not** assert the response text — LLM output is non-deterministic
and the value would shift between models.

Cold-start note: the first run after a fresh login or a long idle window
can take up to a minute before the prompt starts streaming. The test
budget allows 2 minutes for that case. Subsequent runs typically complete
in 10–15 seconds.

## Live diagnostic

For raw protocol inspection (every line of stdin/stdout/stderr printed),
run the script in `scripts/`:

```bash
node scripts/debug-acp.mjs
```

This bypasses Polaris's session manager and talks to the bundled binary
directly. Useful when you suspect a protocol mismatch and want to see
exactly what is on the wire.

## Why it's not in CI

CI runs against the mock fixture only. Three reasons:

- **Cost.** Burning Anthropic credits on every PR pushes is not free.
- **Auth.** GitHub Actions has no Anthropic credentials, and provisioning
  them safely is out of scope for a self-hosted project.
- **Determinism.** LLM latency and content vary; integration runs would
  flake.

The mock fixture is what protects CI. This test is what protects releases:
run it locally before a release-promotion PR if anything in `src/acp/` has
changed.

## Example client

`examples/vibe-coder.mjs` drives a running Polaris instance from outside
the test runner. See `examples/README.md` for the runbook.
