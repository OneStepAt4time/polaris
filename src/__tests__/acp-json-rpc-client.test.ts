import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AcpJsonRpcClient, createAcpJsonRpcClient } from "../acp/json-rpc-client.js";

/**
 * Pair of streams to wire a client to a fake "server":
 *  - serverOut → stdout that the client reads from
 *  - clientOut → stdin that the client writes to (the test reads it to inspect requests)
 */
interface StreamPair {
  client: AcpJsonRpcClient;
  serverWrite: (line: string) => void;
  clientReadLines: () => Promise<string[]>;
  destroy: () => void;
}

function makePair(): StreamPair {
  const clientStdin = new PassThrough(); // what client.stdin writes go here
  const clientStdout = new PassThrough(); // we push fake responses here
  const client = createAcpJsonRpcClient(clientStdin, clientStdout);

  const lines: string[] = [];
  let pending = "";
  clientStdin.on("data", (chunk: Buffer | string) => {
    pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    while (true) {
      const idx = pending.indexOf("\n");
      if (idx === -1) break;
      lines.push(pending.slice(0, idx));
      pending = pending.slice(idx + 1);
    }
  });

  return {
    client,
    serverWrite: (line: string) => {
      clientStdout.write(`${line}\n`);
    },
    clientReadLines: async () => {
      // give the stream a microtask to flush
      await new Promise((r) => setImmediate(r));
      return [...lines];
    },
    destroy: () => {
      client.close();
      clientStdout.end();
      clientStdin.end();
    },
  };
}

describe("createAcpJsonRpcClient", () => {
  let pair: StreamPair;

  beforeEach(() => {
    pair = makePair();
  });

  afterEach(() => {
    pair.destroy();
  });

  it("sends a request and resolves with the response.result", async () => {
    const promise = pair.client.request<string>("ping");

    const lines = await pair.clientReadLines();
    expect(lines).toHaveLength(1);
    const sent = JSON.parse(lines[0] as string) as { id: number; method: string };
    expect(sent.method).toBe("ping");
    expect(typeof sent.id).toBe("number");

    pair.serverWrite(JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: "pong" }));

    await expect(promise).resolves.toBe("pong");
  });

  it("rejects when the response carries an error", async () => {
    const promise = pair.client.request("fail");
    await new Promise((r) => setImmediate(r));
    pair.serverWrite(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "boom" },
      }),
    );
    await expect(promise).rejects.toThrow(/-32000.*boom/);
  });

  it("times out when no response arrives within the configured window", async () => {
    const promise = pair.client.request("slow", undefined, { timeoutMs: 50 });
    await expect(promise).rejects.toThrow(/timed out after 50ms/);
  });

  it("emits 'notification' for server-pushed updates", async () => {
    const received: unknown[] = [];
    pair.client.on("notification", (msg) => received.push(msg));
    pair.serverWrite(JSON.stringify({ jsonrpc: "2.0", method: "update", params: { x: 1 } }));
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "update", params: { x: 1 } });
  });

  it("emits 'request' for server-initiated requests (method + id)", async () => {
    const received: unknown[] = [];
    pair.client.on("request", (msg) => received.push(msg));
    pair.serverWrite(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "session/request_permission",
        params: { tool: "Bash" },
      }),
    );
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 99, method: "session/request_permission" });
  });

  it("emits 'parseError' for malformed lines", async () => {
    const errors: string[] = [];
    pair.client.on("parseError", (line: string) => errors.push(line));
    pair.serverWrite("not-json");
    await new Promise((r) => setImmediate(r));
    expect(errors).toEqual(["not-json"]);
  });

  it("rejects in-flight requests when the stream closes", async () => {
    const promise = pair.client.request("ping");
    pair.client.close();
    await expect(promise).rejects.toThrow(/close/);
  });

  it("rejects new requests after close()", async () => {
    pair.client.close();
    await expect(pair.client.request("ping")).rejects.toThrow(/closed/);
  });

  it("ignores blank lines between messages", async () => {
    const promise = pair.client.request<string>("ping");
    await new Promise((r) => setImmediate(r));
    pair.serverWrite("");
    pair.serverWrite("");
    pair.serverWrite(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "pong" }));
    await expect(promise).resolves.toBe("pong");
  });

  it("correlates multiple concurrent requests by id", async () => {
    const pPing = pair.client.request<string>("ping");
    const pEcho = pair.client.request<{ hello: string }>("echo", { hello: "world" });
    await new Promise((r) => setImmediate(r));

    // Respond out of order to verify correlation.
    pair.serverWrite(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { hello: "world" } }));
    pair.serverWrite(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "pong" }));

    await expect(pPing).resolves.toBe("pong");
    await expect(pEcho).resolves.toEqual({ hello: "world" });
  });
});
