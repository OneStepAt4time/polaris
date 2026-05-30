import {
  type Channel,
  type ChannelMessageOptions,
  type ChannelResult,
  type FetchLike,
  postJson,
} from "./channel.js";

export type { ChannelResult, FetchLike } from "./channel.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * v0.35.0 — when `opts.inlineActions` and `opts.correlationId` are both
 * present, the message ships with a `reply_markup.inline_keyboard` so the
 * user can approve/deny directly from Telegram. callback_data carries
 * `polaris:{sessionPrefix}:{approvalPrefix}:{actionId}` which
 * `telegram-poller.ts` parses on incoming `callback_query` updates.
 *
 * Telegram caps callback_data at 64 bytes. Two full v4 UUIDs (36 chars
 * each) plus the prefix and option overflow that limit (~93 bytes), so
 * we truncate each id to the first 16 chars. The server-side handler
 * resolves the truncated prefix back to the full id via SessionManager
 * lookups — collision probability with 16 hex chars is ~2^-64 per pair,
 * negligible for any realistic load (≤100 active sessions × ≤5 pending
 * approvals = 500 ids in flight).
 *
 * correlationId from RuleMatch is expected to be
 * `{sessionId}:{approvalId}`. We truncate each half here.
 */
const CALLBACK_ID_PREFIX_LEN = 16;
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
    const [sessionFull, approvalFull] = opts.correlationId.split(":");
    const sessionShort = (sessionFull ?? "").slice(0, CALLBACK_ID_PREFIX_LEN);
    const approvalShort = (approvalFull ?? "").slice(0, CALLBACK_ID_PREFIX_LEN);
    if (sessionShort !== "" && approvalShort !== "") {
      body.reply_markup = {
        inline_keyboard: [
          opts.inlineActions.map((a) => ({
            text: a.label,
            callback_data: `polaris:${sessionShort}:${approvalShort}:${a.id}`,
          })),
        ],
      };
    }
  }
  return postJson(fetchImpl, url, body);
}

export function makeTelegramChannel(cfg: TelegramConfig, fetchImpl?: FetchLike): Channel {
  return {
    name: "telegram",
    send: (text, opts) => sendTelegramMessage(cfg, text, fetchImpl, opts),
  };
}
