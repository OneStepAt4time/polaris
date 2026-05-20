import type { Channel, ChannelResult, FetchLike } from "./channel.js";

export interface DiscordConfig {
  webhookUrl: string;
}

export async function sendDiscordMessage(
  cfg: DiscordConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChannelResult> {
  try {
    const res = await fetchImpl(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body };
    }
    // Discord webhooks return 204 No Content on success — still ok.
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function makeDiscordChannel(cfg: DiscordConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "discord",
    send: (text) => sendDiscordMessage(cfg, text, fetchImpl),
  };
}
