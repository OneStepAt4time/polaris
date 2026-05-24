import type { Channel, ChannelResult, FetchLike } from "./channel.js";

export interface WebhookConfig {
  url: string;
}

export interface WebhookPayload {
  /** Rule name (e.g. `cost-threshold-daily`). */
  rule: string;
  /** Dedup key (typically a UTC day or sessionId:atMs). */
  dedupKey: string;
  /** Human-readable Markdown message. */
  message: string;
  /** Source — always "polaris" so downstream filters can distinguish. */
  source: "polaris";
}

export async function sendWebhookMessage(
  cfg: WebhookConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  meta: { rule?: string; dedupKey?: string } = {},
): Promise<ChannelResult> {
  const payload: WebhookPayload = {
    rule: meta.rule ?? "polaris",
    dedupKey: meta.dedupKey ?? "",
    message: text,
    source: "polaris",
  };
  try {
    const res = await fetchImpl(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function makeWebhookChannel(cfg: WebhookConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "webhook",
    send: (text) => sendWebhookMessage(cfg, text, fetchImpl),
  };
}
