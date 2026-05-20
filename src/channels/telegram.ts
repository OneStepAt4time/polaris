export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface ChannelResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

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
