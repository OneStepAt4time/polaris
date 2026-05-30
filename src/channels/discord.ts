import { type Channel, type ChannelResult, type FetchLike, postJson } from "./channel.js";

export interface DiscordConfig {
  webhookUrl: string;
}

export async function sendDiscordMessage(
  cfg: DiscordConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChannelResult> {
  // Discord webhooks return 204 No Content on success — postJson treats any 2xx as ok.
  return postJson(fetchImpl, cfg.webhookUrl, { content: text });
}

export function makeDiscordChannel(cfg: DiscordConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "discord",
    send: (text) => sendDiscordMessage(cfg, text, fetchImpl),
  };
}
