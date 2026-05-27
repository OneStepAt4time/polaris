/**
 * v0.35.0 — Telegram Bot API long-poller that handles `callback_query`
 * updates from inline buttons. When a user taps an Allow/Deny button on a
 * Polaris approval message, Telegram posts a callback_query; this poller
 * dispatches it to the supplied handler so SessionManager can respond to
 * the pending approval.
 *
 * Polling rather than webhook because:
 *   - no public URL needed (self-hosted MVP),
 *   - no need to coexist with an existing webhook the user may have set,
 *   - simpler error handling — we just retry on the next tick.
 *
 * The callback_data format set by `telegram.ts` is
 * `polaris:{correlationId}:{actionId}`, where correlationId itself is
 * `{sessionId}:{approvalId}`. We split on `:` carefully because both
 * UUIDs are 36 chars and contain no `:`.
 */

export interface TelegramCallbackPayload {
  sessionId: string;
  approvalId: string;
  optionId: string;
  /** Telegram callback_query.id — needed to call answerCallbackQuery. */
  callbackQueryId: string;
  /** Username or first-name of the responder, for logging. */
  fromUser: string;
}

export type CallbackHandler = (
  payload: TelegramCallbackPayload,
) => Promise<{ ok: boolean; message?: string }>;

export interface TelegramPollerConfig {
  botToken: string;
  /** Long-poll timeout in seconds. Telegram caps at 50. */
  longPollSeconds?: number;
  /** Hard timeout on the HTTP request itself, in ms. */
  fetchTimeoutMs?: number;
}

export interface TelegramPollerHandle {
  /** Stop the loop on next tick. The in-flight getUpdates request is left
   * to time out on its own. */
  stop(): void;
}

export type PollerLog = (msg: string) => void;

const noopLog: PollerLog = () => {};

interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from?: { username?: string; first_name?: string };
    data?: string;
  };
}

export function startTelegramPoller(
  cfg: TelegramPollerConfig,
  handler: CallbackHandler,
  log: PollerLog = noopLog,
): TelegramPollerHandle {
  const longPollSec = cfg.longPollSeconds ?? 30;
  const fetchTimeoutMs = cfg.fetchTimeoutMs ?? (longPollSec + 10) * 1000;
  const base = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}`;
  let stopped = false;
  let offset = 0;

  async function tick(): Promise<void> {
    if (stopped) return;
    const offsetParam = offset > 0 ? `&offset=${offset}` : "";
    const url = `${base}/getUpdates?timeout=${longPollSec}${offsetParam}&allowed_updates=%5B%22callback_query%22%5D`;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        log(`[telegram-poller] HTTP ${res.status} — backing off 5s`);
        await sleep(5000);
        return;
      }
      const body = (await res.json()) as { ok?: boolean; result?: TgUpdate[] };
      if (!body.ok || !Array.isArray(body.result)) return;
      for (const u of body.result) {
        offset = Math.max(offset, u.update_id + 1);
        const cb = u.callback_query;
        if (!cb || typeof cb.data !== "string") continue;
        const parsed = parseCallbackData(cb.data);
        if (!parsed) {
          log(`[telegram-poller] ignored callback_data: ${cb.data}`);
          await answerCallbackQuery(base, cb.id, "Unrecognised callback");
          continue;
        }
        const fromUser = cb.from?.username ?? cb.from?.first_name ?? "user";
        try {
          const out = await handler({ ...parsed, callbackQueryId: cb.id, fromUser });
          await answerCallbackQuery(base, cb.id, out.message ?? (out.ok ? "Done" : "Failed"));
          log(
            `[telegram-poller] approval ${parsed.approvalId.slice(0, 12)} → ${parsed.optionId} by ${fromUser} (ok=${out.ok})`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`[telegram-poller] handler error: ${msg}`);
          await answerCallbackQuery(base, cb.id, "Error handling approval");
        }
      }
    } catch (e) {
      if (!stopped) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted")) log(`[telegram-poller] tick error: ${msg}`);
        await sleep(5000);
      }
    } finally {
      clearTimeout(tm);
    }
  }

  (async () => {
    while (!stopped) {
      await tick();
    }
  })();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

/**
 * callback_data is `polaris:{sessionId}:{approvalId}:{optionId}`. The first
 * two ids are UUIDs without `:`, so we can split safely on `:`. We accept
 * any optionId for forward-compat (engine may add new actions later).
 */
export function parseCallbackData(raw: string): {
  sessionId: string;
  approvalId: string;
  optionId: string;
} | null {
  if (!raw.startsWith("polaris:")) return null;
  const parts = raw.slice("polaris:".length).split(":");
  if (parts.length < 3) return null;
  const optionId = parts[parts.length - 1] ?? "";
  // correlationId we sent was `${sessionId}:${approvalId}`. Anything between
  // the first segment and the last is the approvalId (defensive: handle
  // future format changes that add segments).
  const sessionId = parts[0] ?? "";
  const approvalId = parts.slice(1, parts.length - 1).join(":");
  if (sessionId === "" || approvalId === "" || optionId === "") return null;
  return { sessionId, approvalId, optionId };
}

async function answerCallbackQuery(base: string, id: string, text: string): Promise<void> {
  try {
    await fetch(`${base}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text, show_alert: false }),
    });
  } catch {
    // Best-effort ack — if Telegram refuses we already responded to the
    // approval, so the next tick is the only fallback we need.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
