import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { checkRateLimitNear } from "../rules/rate-limit-near.js";

function seed(db: PolarisDb, payload: Record<string, unknown>): void {
  db.insertRateLimitSample({
    tsMs: Date.now(),
    httpStatus: 200,
    rawJson: JSON.stringify(payload),
    error: null,
  });
}

describe("checkRateLimitNear", () => {
  let db: PolarisDb;
  const now = new Date("2026-05-20T12:00:00Z").getTime();

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns empty when threshold is 0 (rule disabled)", () => {
    seed(db, { five_hour: { utilization: 95 } });
    expect(checkRateLimitNear(db, { thresholdPct: 0 }, now)).toEqual([]);
  });

  it("returns empty when there is no rate-limit sample in the DB", () => {
    expect(checkRateLimitNear(db, { thresholdPct: 80 }, now)).toEqual([]);
  });

  it("returns empty when the raw JSON is malformed", () => {
    db.insertRateLimitSample({
      tsMs: Date.now(),
      httpStatus: 200,
      rawJson: "not json",
      error: null,
    });
    expect(checkRateLimitNear(db, { thresholdPct: 80 }, now)).toEqual([]);
  });

  it("emits one match per window above the threshold (0-100 input)", () => {
    seed(db, {
      five_hour: { utilization: 95 },
      seven_day: { utilization: 80 },
      seven_day_opus: { utilization: 10 },
      seven_day_oauth_apps: null,
    });
    const matches = checkRateLimitNear(db, { thresholdPct: 80 }, now);
    expect(matches).toHaveLength(2);
    const names = matches.map((m) => m.ruleName).sort();
    expect(names).toEqual(["rate-limit-near:five_hour", "rate-limit-near:seven_day"]);
    expect(matches[0]?.message).toMatch(/Utilization/);
    expect(matches[0]?.dedupKey).toBe("2026-05-20");
  });

  it("emits matches when utilization is in the 0-1 fractional form too", () => {
    seed(db, { five_hour: { utilization: 0.95 } });
    const matches = checkRateLimitNear(db, { thresholdPct: 80 }, now);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("95%");
  });

  it("ignores windows with no utilization or with null payload", () => {
    seed(db, {
      five_hour: { utilization: 90 },
      extra_usage: { is_enabled: false },
      seven_day_opus: null,
    });
    const matches = checkRateLimitNear(db, { thresholdPct: 80 }, now);
    expect(matches.map((m) => m.ruleName)).toEqual(["rate-limit-near:five_hour"]);
  });

  it("scopes dedup_key by UTC day so a single window fires once per day", () => {
    seed(db, { five_hour: { utilization: 95 } });
    const matches1 = checkRateLimitNear(db, { thresholdPct: 80 }, now);
    const matches2 = checkRateLimitNear(db, { thresholdPct: 80 }, now);
    expect(matches1[0]?.dedupKey).toBe(matches2[0]?.dedupKey);
    const tomorrow = now + 24 * 60 * 60 * 1000;
    const matches3 = checkRateLimitNear(db, { thresholdPct: 80 }, tomorrow);
    expect(matches3[0]?.dedupKey).not.toBe(matches1[0]?.dedupKey);
  });
});
