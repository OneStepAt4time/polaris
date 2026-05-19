# Examples

Reference scripts that drive a running Polaris instance. They are not part
of the test suite — they exist so you can verify end-to-end that an
external caller can use Polaris as a control plane for Claude Code.

## `vibe-coder.mjs`

Plain-Node interactive client. Creates a session, opens the SSE event
stream, sends one prompt from `argv`, and asks the user (`y/N` on stdin)
whether to allow each permission request the agent raises.

```bash
# In one shell: run Polaris
POLARIS_AUTH_TOKEN=devtoken-1234 \
POLARIS_PORT=9180                \
npm run build                     \
&& node dist/server.js

# In another shell: drive it
POLARIS_URL=http://localhost:9180   \
POLARIS_AUTH_TOKEN=devtoken-1234     \
node examples/vibe-coder.mjs "What files are in this directory?"
```

Env vars consumed by the script:

| Var | Default | Meaning |
|---|---|---|
| `POLARIS_URL` | `http://localhost:9180` | Polaris base URL |
| `POLARIS_AUTH_TOKEN` | _(required)_ | Bearer token configured on the server |
| `POLARIS_CLIENT_CWD` | `process.cwd()` | Working directory the session opens in |

The script exits 0 on success, 1 on stream/HTTP error, 2 on usage error.

## Notes

- Zero npm dependencies — uses `fetch`, `ReadableStream`, and
  `node:readline` only. Runs on the same Node version Polaris targets
  (≥22).
- Approvals: when the agent emits `session/request_permission`, the
  script prints the tool name + input and reads `y/N` from stdin. Replies
  via `POST /v1/sessions/:id/approvals/:approvalId`.
- For a non-interactive smoke test, see
  [`docs/integration-testing.md`](../docs/integration-testing.md).
