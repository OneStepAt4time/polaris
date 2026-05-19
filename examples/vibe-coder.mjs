#!/usr/bin/env node
// vibe-coder.mjs — minimal example client that drives Polaris like a TUI.
//
// Demonstrates the full v0.5.0 control plane: create a session, open the
// SSE event stream, send a prompt, and resolve any approval-request the
// agent emits (interactive y/n on stdin).
//
// Usage:
//   POLARIS_URL=http://localhost:9180  \
//   POLARIS_AUTH_TOKEN=<token>          \
//   node examples/vibe-coder.mjs "Show me the package.json"
//
// Zero dependencies; runs on plain Node 22+.

import { createInterface } from "node:readline";

const URL = process.env.POLARIS_URL || "http://localhost:9180";
const TOKEN = process.env.POLARIS_AUTH_TOKEN;
const CWD = process.env.POLARIS_CLIENT_CWD || process.cwd();

if (!TOKEN) {
  console.error("POLARIS_AUTH_TOKEN is required");
  process.exit(2);
}
const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: node examples/vibe-coder.mjs "<your prompt>"');
  process.exit(2);
}

const auth = { authorization: `Bearer ${TOKEN}` };

async function http(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...auth,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res;
}

function askYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

async function main() {
  // Create session.
  const sessionRes = await http("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ cwd: CWD }),
  });
  const session = await sessionRes.json();
  console.log(`session ${session.id} (cwd=${session.cwd})`);

  // Open SSE in the background so we see updates + approval requests as
  // they arrive. The connection stays open until the script exits.
  const sse = await fetch(`${URL}/v1/sessions/${session.id}/events`, {
    headers: auth,
  });
  if (!sse.ok) throw new Error(`SSE failed: ${sse.status}`);

  let buffer = "";
  let sseClosed = false;
  const decoder = new TextDecoder();
  const reader = sse.body.getReader();
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        sseClosed = true;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let event;
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        await handleEvent(session.id, event);
      }
    }
  })().catch((err) => {
    if (!sseClosed) console.error("SSE stream error:", err);
  });

  // Send the prompt. This call blocks until the agent finishes the turn
  // (or until the script approves/denies any pending permission requests
  // out of band via the SSE handler above).
  console.log(`\n→ ${prompt}\n`);
  const replyRes = await http(`/v1/sessions/${session.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: prompt, timeoutMs: 5 * 60 * 1000 }),
  });
  const reply = await replyRes.json();
  console.log(`\n← stopReason=${reply.stopReason}`);
  if (reply.userMessageId) console.log(`  userMessageId=${reply.userMessageId}`);

  await http(`/v1/sessions/${session.id}`, { method: "DELETE" });
  await reader.cancel().catch(() => {});
}

async function handleEvent(sessionId, event) {
  switch (event.type) {
    case "update": {
      const text = event.payload?.params?.text;
      const kind = event.payload?.params?.kind ?? "update";
      if (text) console.log(`  [${kind}] ${text}`);
      else console.log(`  [${kind}]`);
      return;
    }
    case "approval-request": {
      const { approvalId, params } = event.approval;
      const tool = params?.toolUse?.name ?? "unknown-tool";
      const input = JSON.stringify(params?.toolUse?.input ?? {});
      const allow = await askYesNo(`Allow ${tool}(${input})?`);
      const body = allow
        ? { outcome: "selected", optionId: params?.options?.[0]?.id ?? "allow" }
        : { outcome: "cancelled" };
      await http(`/v1/sessions/${sessionId}/approvals/${approvalId}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return;
    }
    case "session-closed":
      return;
    default:
      console.log(`  [?] ${event.type}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
