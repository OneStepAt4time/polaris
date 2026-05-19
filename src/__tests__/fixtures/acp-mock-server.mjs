#!/usr/bin/env node
// Test fixture: a minimal in-process ACP "server" that reads JSON-RPC
// requests on stdin and emits canned responses on stdout. Used by
// acp-spawner.test.ts, server-acp.test.ts, session-manager.test.ts,
// and server-sessions.test.ts so the gate doesn't need a real `claude`
// install or the actual @agentclientprotocol bin.

let buffer = "";
let sessionCounter = 0;
const sessions = new Map();

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
        // Stream two updates then the final response, so the manager has
        // something to collect into the per-prompt updates window.
        notify("session/update", { sessionId: sid, kind: "thinking", text: "..." });
        notify("session/update", {
          sessionId: sid,
          kind: "agent_message",
          text: `echo:${userText}`,
        });
        // Special trigger: text "ask-permission" exercises the auto-deny path.
        if (userText === "ask-permission") {
          serverRequest(100 + msg.id, "session/request_permission", {
            sessionId: sid,
            toolUse: { name: "Bash", input: { command: "ls" } },
          });
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
    // Notification — no reply. Fixture forgets the session.
    if (typeof msg.params?.sessionId === "string") {
      sessions.delete(msg.params.sessionId);
    }
  }
}
