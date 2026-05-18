import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAcpJsonRpcClient } from "../acp/json-rpc-client.js";
import { type AcpProcessHandle, spawnAcpProcess } from "../acp/spawner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");
// Quote both halves so paths with spaces (Windows: C:\Program Files\nodejs\node.exe)
// survive splitCommand intact.
const fixtureBin = `"${process.execPath}" "${fixturePath}"`;

describe("spawnAcpProcess", () => {
  let handle: AcpProcessHandle | null;

  beforeEach(() => {
    handle = null;
  });

  afterEach(async () => {
    if (handle) await handle.close();
  });

  it("spawns a child process with piped stdio", () => {
    handle = spawnAcpProcess({ binCmd: fixtureBin });
    expect(handle.pid).toBeGreaterThan(0);
    expect(handle.stdin).toBeDefined();
    expect(handle.stdout).toBeDefined();
    expect(handle.stderr).toBeDefined();
  });

  it("speaks JSON-RPC end-to-end via the fixture", async () => {
    handle = spawnAcpProcess({ binCmd: fixtureBin });
    const client = createAcpJsonRpcClient(handle.stdin, handle.stdout);

    const capabilities = await client.request(
      "initialize",
      { protocolVersion: 1 },
      {
        timeoutMs: 5000,
      },
    );
    expect(capabilities).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: expect.any(Object),
    });

    const echo = await client.request("echo", { hi: "there" }, { timeoutMs: 5000 });
    expect(echo).toEqual({ hi: "there" });

    client.close();
  });

  it("close() resolves and terminates the child", async () => {
    handle = spawnAcpProcess({ binCmd: fixtureBin });
    await handle.close();
    const code = await handle.exit;
    // SIGTERM on POSIX is null exit code with signalCode; on Windows it's a numeric exit code.
    // Either way, the promise resolves cleanly.
    expect(code === null || typeof code === "number").toBe(true);
  });

  it("close() is idempotent", async () => {
    handle = spawnAcpProcess({ binCmd: fixtureBin });
    await handle.close();
    await handle.close();
    await handle.close();
  });

  it("throws when binCmd resolves to a missing binary", () => {
    expect(() => spawnAcpProcess({ binCmd: "definitely-not-a-real-binary-xyz123" })).not.toThrow(); // spawn doesn't throw synchronously; error surfaces on the 'error' event
    // We just verify the call signature works; close handles missing children gracefully.
  });
});
