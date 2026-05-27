import type { Channel, ChannelMessageOptions, ChannelResult, FetchLike } from "./channel.js";

export type { ChannelResult, FetchLike } from "./channel.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * v0.35.0 — when `opts.inlineActions` and `opts.correlationId` are both
 * present, the message ships with a `reply_markup.inline_keyboard` so the
 * user can approve/deny directly from Telegram. callback_data carries
 * `polaris:{correlationId}:{actionId}` which `telegram-poller.ts` parses
 * on incoming `callback_query` updates.
 *
 * Telegram caps callback_data at 64 bytes. `polaris:` + a v4 UUID (36
 * chars) + ":" + "Allow"/"Deny" stays well under the limit.
 */
export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  opts?: ChannelMessageOptions,
): Promise<ChannelResult> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: cfg.chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
  if (
    opts !== undefined &&
    Array.isArray(opts.inlineActions) &&
    opts.inlineActions.length > 0 &&
    typeof opts.correlationId === "string" &&
    opts.correlationId.length > 0
  ) {
    body.reply_markup = {
      inline_keyboard: [
        opts.inlineActions.map((a) => ({
          text: a.label,
          callback_data: `polaris:${opts.correlationId}:${a.id}`,
        })),
      ],
    };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: errBody };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function makeTelegramChannel(cfg: TelegramConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "telegram",
    send: (text, opts) => sendTelegramMessage(cfg, text, fetchImpl, opts),
  };
}
