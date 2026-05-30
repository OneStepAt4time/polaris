import { type Channel, type ChannelResult, type FetchLike, postJson } from "./channel.js";

export interface SlackConfig {
  webhookUrl: string;
}

export async function sendSlackMessage(
  cfg: SlackConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChannelResult> {
  return postJson(fetchImpl, cfg.webhookUrl, { text });
}

export function makeSlackChannel(cfg: SlackConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "slack",
    send: (text) => sendSlackMessage(cfg, text, fetchImpl),
  };
}
