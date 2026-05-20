import type { Channel, ChannelResult, FetchLike } from "./channel.js";

export interface SlackConfig {
  webhookUrl: string;
}

export async function sendSlackMessage(
  cfg: SlackConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChannelResult> {
  try {
    const res = await fetchImpl(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
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

export function makeSlackChannel(cfg: SlackConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "slack",
    send: (text) => sendSlackMessage(cfg, text, fetchImpl),
  };
}
