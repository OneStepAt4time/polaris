import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");
const TOKEN = "sse-test-token-aaaaa";

interface BuiltApp {
  app: FastifyInstance;
  url: string;
}

function getReader(res: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!res.body) throw new Error("response has no body");
  return res.body.getReader();
}

async function readSseLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: InstanceType<typeof TextDecoder>,
  state: { buffer: string },
): Promise<{ type: string; data: unknown } | null> {
  // Returns the next SSE `data: <json>` event, or null on EOF.
  while (true) {
    const sep = state.buffer.indexOf("\n\n");
    if (sep !== -1) {
      const frame = state.buffer.slice(0, sep);
      state.buffer = state.buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const json = JSON.parse(dataLine.slice(6)) as { type: string };
      return { type: json.type, data: json };
    }
    const { value, done } = await reader.read();
    if (done) return null;
    state.buffer += decoder.decode(value, { stream: true });
  }
}

describe("SSE + approval handshake", () => {
  let built: BuiltApp;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    process.env.POLARIS_ACP_BIN = `"${process.execPath}" "${fixturePath}"`;
    const b = await buildServer();
    await b.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = b.app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    built = { app: b.app, url: `http://127.0.0.1:${addr.port}` };
  });

  afterAll(async () => {
    await built.app.close();
  });

  async function createSession(): Promise<string> {
    const res = await fetch(`${built.url}/v1/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ cwd: "/tmp/sse" }),
    });
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  it("GET /v1/sessions/:id/events without auth returns 401", async () => {
    const res = await fetch(`${built.url}/v1/sessions/nope/events`);
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("GET /v1/sessions/:id/events returns 404 for unknown session", async () => {
    const res = await fetch(`${built.url}/v1/sessions/nope/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("streams update events during a prompt", async () => {
    const id = await createSession();
    const sseRes = await fetch(`${built.url}/v1/sessions/${id}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = getReader(sseRes);
    const decoder = new TextDecoder();
    const state = { buffer: "" };

    // Fire the prompt asynchronously while we read the stream.
    const promptDone = fetch(`${built.url}/v1/sessions/${id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ text: "hello" }),
    }).then((r) => r.json());

    const first = await readSseLine(reader, decoder, state);
    const second = await readSseLine(reader, decoder, state);
    expect(first?.type).toBe("update");
    expect(second?.type).toBe("update");
    await reader.cancel();
    await promptDone;
  });

  it("approval handshake: SSE emits request, POST responds, prompt resolves", async () => {
    const id = await createSession();
    const sseRes = await fetch(`${built.url}/v1/sessions/${id}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const reader = getReader(sseRes);
    const decoder = new TextDecoder();
    const state = { buffer: "" };

    const promptDone = fetch(`${built.url}/v1/sessions/${id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ text: "ask-permission" }),
    }).then((r) => r.json() as Promise<{ stopReason: string }>);

    // Drain until the approval-request event lands.
    let approvalId: string | undefined;
    for (let i = 0; i < 10 && approvalId === undefined; i += 1) {
      const evt = await readSseLine(reader, decoder, state);
      if (evt?.type === "approval-request") {
        const data = evt.data as { approval: { approvalId: string } };
        approvalId = data.approval.approvalId;
      }
    }
    expect(approvalId).toBeDefined();

    const respond = await fetch(`${built.url}/v1/sessions/${id}/approvals/${approvalId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ outcome: "selected", optionId: "allow" }),
    });
    expect(respond.status).toBe(204);

    const result = await promptDone;
    expect(result.stopReason).toBe("end_turn");
    await reader.cancel();
  });

  it("POST /v1/sessions/:id/approvals/:approvalId returns 404 for unknown approval", async () => {
    const id = await createSession();
    const res = await fetch(`${built.url}/v1/sessions/${id}/approvals/bogus`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ outcome: "cancelled" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /v1/sessions/:id/approvals lists pending approvals", async () => {
    const id = await createSession();
    const res = await fetch(`${built.url}/v1/sessions/${id}/approvals`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: unknown[] };
    expect(Array.isArray(body.approvals)).toBe(true);
  });
});
