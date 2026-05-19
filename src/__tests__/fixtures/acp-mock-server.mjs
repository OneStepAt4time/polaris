#!/usr/bin/env node
// Test fixture: a minimal in-process ACP "server" that reads JSON-RPC
// requests on stdin and emits canned responses on stdout. Used by
// acp-spawner.test.ts and server-acp.test.ts so the gate doesn't need
// a real `claude` install or the actual @agentclientprotocol bin.

let buffer = "";

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

function handle(msg) {
  if (typeof msg.id !== "undefined" && msg.method) {
    switch (msg.method) {
      case "initialize":
        reply(msg.id, {
          protocolVersion: 1,
          agentCapabilities: {
            promptCapabilities: { audio: false, image: false },
          },
          authMethods: [],
        });
        return;
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
}
