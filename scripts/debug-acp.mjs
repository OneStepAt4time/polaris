#!/usr/bin/env node
// One-shot diagnostic: spawn the bundled claude-agent-acp, run
// initialize → newSession → prompt, and log every line of stdin/stdout/stderr.
// Not part of the test suite. Run as:
//   node scripts/debug-acp.mjs

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const req = createRequire(import.meta.url);
const pkgPath = req.resolve("@agentclientprotocol/claude-agent-acp/package.json");
const pkg = req(pkgPath);
const binEntry = pkg.bin?.["claude-agent-acp"];
const child = spawn(process.execPath, [join(dirname(pkgPath), binEntry)], {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false,
  windowsHide: true,
});

child.stderr.on("data", (c) => process.stderr.write(`[stderr] ${c}`));
child.on("exit", (code) => console.log(`[exit] code=${code}`));

let buffer = "";
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    console.log(`[recv] ${line.slice(0, 400)}${line.length > 400 ? "...(trunc)" : ""}`);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    } else if ("id" in msg && msg.method) {
      // Server-initiated request — auto-respond with method-not-found so the
      // agent doesn't block on an unhandled callback while we debug.
      console.log(`[server-req] ${msg.method} (auto-deny)`);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "debug auto-deny" } })}\n`,
      );
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  console.log(`[send] ${JSON.stringify(msg).slice(0, 400)}`);
  child.stdin.write(`${JSON.stringify(msg)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 90_000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      if (response.error) reject(new Error(JSON.stringify(response.error)));
      else resolve(response.result);
    });
  });
}

try {
  const initRes = await rpc("initialize", { protocolVersion: 1, clientCapabilities: {} });
  console.log("[init-ok]", JSON.stringify(initRes, null, 2).slice(0, 500));

  const newRes = await rpc("session/new", { cwd: tmpdir(), mcpServers: [] });
  console.log("[new-ok]", newRes);

  const promptRes = await rpc("session/prompt", {
    sessionId: newRes.sessionId,
    messageId: randomUUID(),
    prompt: [{ type: "text", text: "Reply with exactly the word: hello" }],
  });
  console.log("[prompt-ok]", JSON.stringify(promptRes, null, 2));
} catch (err) {
  console.error("[error]", err.message);
} finally {
  child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1000);
}
