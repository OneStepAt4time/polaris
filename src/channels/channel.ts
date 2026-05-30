export interface ChannelResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * v0.35.0 — optional inline actions for channels that can render them
 * (currently Telegram via inline_keyboard). Slack/Discord/Webhook ignore
 * the field; they're still text-only delivery.
 *
 * `correlationId` is what the channel echoes back when the user picks an
 * action. Polaris uses it to look up the pending approval and call
 * `SessionManager.respondToApproval`.
 */
export interface InlineAction {
  id: string;
  label: string;
}

export interface ChannelMessageOptions {
  inlineActions?: InlineAction[];
  correlationId?: string;
}

export interface Channel {
  /** Human-readable channel name for logging (e.g. "telegram", "slack"). */
  readonly name: string;
  send(text: string, opts?: ChannelMessageOptions): Promise<ChannelResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Shared JSON POST for every channel adapter (telegram/slack/discord/webhook).
 * Each adapter builds its own payload shape, then hands it here for the
 * identical transport + result-mapping tail:
 *  - POST application/json
 *  - non-2xx → { ok:false, status, error:<body text> }  (Discord's 204 is 2xx → ok)
 *  - thrown   → { ok:false, error:<message> }
 */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
): Promise<ChannelResult> {
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
