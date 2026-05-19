#!/usr/bin/env node
// Test fixture: a minimal in-process ACP "server" that reads JSON-RPC
// requests on stdin and emits canned responses on stdout. Used by
// acp-spawner.test.ts, server-acp.test.ts, session-manager.test.ts,
// server-sessions.test.ts, and server-sse.test.ts so the gate doesn't
// need a real `claude` install or the actual @agentclientprotocol bin.

let buffer = "";
let sessionCounter = 0;
let requestCounter = 1000;
const sessions = new Map();
// Pending server-initiated permission requests: map request-id → callback
// invoked when the client responds. The callback gets the response object
// so the fixture can finalize the prompt only after the client decides.
const pendingPermissionResponses = new Map();

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line === "") continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function notify(method, params) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function serverRequest(id, method, params) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

function handle(msg) {
  // Client → Agent response to a previously-issued server-initiated request.
  if (
    typeof msg.id !== "undefined" &&
    !msg.method &&
    (msg.result !== undefined || msg.error !== undefined)
  ) {
    const cb = pendingPermissionResponses.get(msg.id);
    if (cb) {
      pendingPermissionResponses.delete(msg.id);
      cb(msg);
    }
    return;
  }

  if (typeof msg.id !== "undefined" && msg.method) {
    switch (msg.method) {
      case "initialize":
        reply(msg.id, {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { audio: false, image: false } },
          authMethods: [],
        });
        return;
      case "session/new": {
        sessionCounter += 1;
        const sessionId = `fixture-session-${sessionCounter}`;
        sessions.set(sessionId, { cwd: msg.params?.cwd ?? "" });
        reply(msg.id, { sessionId });
        return;
      }
      case "session/prompt": {
        const sid = msg.params?.sessionId;
        if (!sessions.has(sid)) {
          replyError(msg.id, -32602, `Unknown session: ${sid}`);
          return;
        }
        const userText = msg.params?.prompt?.[0]?.text ?? "";
        notify("session/update", { sessionId: sid, kind: "thinking", text: "..." });
        notify("session/update", {
          sessionId: sid,
          kind: "agent_message",
          text: `echo:${userText}`,
        });
        if (userText === "ask-permission") {
          requestCounter += 1;
          const permId = requestCounter;
          pendingPermissionResponses.set(permId, (response) => {
            // Echo the resolved outcome back into the prompt response so tests
            // can assert the full round-trip.
            reply(msg.id, {
              stopReason: "end_turn",
              userMessageId: msg.params?.messageId ?? null,
              approvalOutcome: response.result?.outcome ?? null,
            });
          });
          serverRequest(permId, "session/request_permission", {
            sessionId: sid,
            toolUse: { name: "Bash", input: { command: "ls" } },
            options: [
              { id: "allow", name: "Allow", kind: "allow_once" },
              { id: "deny", name: "Deny", kind: "reject_once" },
            ],
          });
          return;
        }
        reply(msg.id, { stopReason: "end_turn", userMessageId: msg.params?.messageId ?? null });
        return;
      }
      case "ping":
        reply(msg.id, "pong");
        return;
      case "echo":
        reply(msg.id, msg.params);
        return;
      case "fail":
        replyError(msg.id, -32000, "fixture-induced failure");
        return;
      default:
        replyError(msg.id, -32601, `Method not found: ${msg.method}`);
        return;
    }
  }
  if (msg.method === "broadcast") {
    notify("update", { from: "fixture", echo: msg.params });
  }
  if (msg.method === "session/cancel") {
    if (typeof msg.params?.sessionId === "string") {
      sessions.delete(msg.params.sessionId);
    }
  }
}
