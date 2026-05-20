import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { type FetchLike, fetchRateLimitOnce, startRateLimitPoller } from "../rate-limit/poller.js";

function makeFetch(reply: {
  ok?: boolean;
  status: number;
  body?: string;
  throws?: string;
}): FetchLike {
  return async (url, init) => {
    if (reply.throws) throw new Error(reply.throws);
    // sanity: ensure the auth header is present so we know the caller built the request right
    if (!init.headers.Authorization?.startsWith("Bearer ")) {
      throw new Error(`missing auth header in test fixture: ${url}`);
    }
    return {
      ok: reply.ok ?? reply.status < 400,
      status: reply.status,
      text: async () => reply.body ?? "",
    };
  };
}

describe("fetchRateLimitOnce", () => {
  it("returns the raw JSON body when the HTTP response is 2xx", async () => {
    const fetchImpl = makeFetch({ status: 200, body: '{"five_hour":{"utilization":0.4}}' });
    const sample = await fetchRateLimitOnce({ credentials: { accessToken: "tok" } }, fetchImpl);
    expect(sample.httpStatus).toBe(200);
    expect(sample.rawJson).toBe('{"five_hour":{"utilization":0.4}}');
    expect(sample.error).toBeNull();
  });

  it("returns the body in `error` when the HTTP response is non-2xx", async () => {
    const fetchImpl = makeFetch({ status: 401, ok: false, body: "unauthorized" });
    const sample = await fetchRateLimitOnce({ credentials: { accessToken: "tok" } }, fetchImpl);
    expect(sample.httpStatus).toBe(401);
    expect(sample.rawJson).toBeNull();
    expect(sample.error).toContain("unauthorized");
  });

  it("returns the error message when fetch itself throws", async () => {
    const fetchImpl = makeFetch({ status: 0, throws: "network down" });
    const sample = await fetchRateLimitOnce({ credentials: { accessToken: "tok" } }, fetchImpl);
    expect(sample.httpStatus).toBe(0);
    expect(sample.error).toBe("network down");
  });
});

describe("startRateLimitPoller", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("inserts a sample on every pollOnce() and exposes the latest via getLatestRateLimitSample()", async () => {
    const fetchImpl = makeFetch({ status: 200, body: '{"five_hour":{"utilization":0.5}}' });
    const handle = startRateLimitPoller(
      db,
      { credentials: { accessToken: "tok" }, intervalMs: 60 * 60 * 1000 },
      () => {},
      fetchImpl,
    );
    try {
      await handle.pollOnce();
    } finally {
      handle.stop();
    }
    const latest = db.getLatestRateLimitSample();
    expect(latest?.httpStatus).toBe(200);
    expect(latest?.rawJson).toContain("five_hour");
  });

  it("stores the failure when the HTTP call returns non-2xx", async () => {
    const fetchImpl = makeFetch({ status: 500, ok: false, body: "server boom" });
    const handle = startRateLimitPoller(
      db,
      { credentials: { accessToken: "tok" }, intervalMs: 60 * 60 * 1000 },
      () => {},
      fetchImpl,
    );
    try {
      await handle.pollOnce();
    } finally {
      handle.stop();
    }
    const latest = db.getLatestRateLimitSample();
    expect(latest?.httpStatus).toBe(500);
    expect(latest?.rawJson).toBeNull();
    expect(latest?.error).toContain("server boom");
  });
});
