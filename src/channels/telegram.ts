import type { Channel, ChannelResult, FetchLike } from "./channel.js";

export type { ChannelResult, FetchLike } from "./channel.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChannelResult> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
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

export function makeTelegramChannel(cfg: TelegramConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "telegram",
    send: (text) => sendTelegramMessage(cfg, text, fetchImpl),
  };
}
