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
