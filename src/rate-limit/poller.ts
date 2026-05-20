import type { PolarisDb, RateLimitSample } from "../db.js";
import type { OAuthCredentials } from "./oauth.js";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_INTERVAL_MS = 8 * 60 * 1000;

export interface PollerConfig {
  credentials: OAuthCredentials;
  endpoint?: string;
  intervalMs?: number;
}

export interface PollerHandle {
  pollOnce(): Promise<RateLimitSample>;
  stop(): void;
}

export type PollerLog = (msg: string) => void;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const noopLog: PollerLog = () => {};

export async function fetchRateLimitOnce(
  cfg: PollerConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<RateLimitSample> {
  const tsMs = Date.now();
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT;
  try {
    const res = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.credentials.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        tsMs,
        httpStatus: res.status,
        rawJson: null,
        error: body.slice(0, 500) || `HTTP ${res.status}`,
      };
    }
    return { tsMs, httpStatus: res.status, rawJson: body, error: null };
  } catch (e) {
    return {
      tsMs,
      httpStatus: 0,
      rawJson: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function startRateLimitPoller(
  db: PolarisDb,
  cfg: PollerConfig,
  log: PollerLog = noopLog,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): PollerHandle {
  const intervalMs = cfg.intervalMs ?? DEFAULT_INTERVAL_MS;
  const pollOnce = async (): Promise<RateLimitSample> => {
    const sample = await fetchRateLimitOnce(cfg, fetchImpl);
    db.insertRateLimitSample(sample);
    if (sample.error !== null) {
      log(`[rate-limit] poll failed (status=${sample.httpStatus}): ${sample.error.slice(0, 120)}`);
    } else {
      log(`[rate-limit] poll ok (status=${sample.httpStatus})`);
    }
    return sample;
  };
  // Fire-and-forget initial poll so the UI has data sooner than +interval.
  void pollOnce().catch((e) => log(`[rate-limit] initial poll error: ${String(e)}`));
  const handle = setInterval(() => {
    pollOnce().catch((e) => log(`[rate-limit] tick error: ${String(e)}`));
  }, intervalMs);
  return {
    pollOnce,
    stop: () => clearInterval(handle),
  };
}
