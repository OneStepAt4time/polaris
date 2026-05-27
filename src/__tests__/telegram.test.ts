import { describe, expect, it } from "vitest";
import { type FetchLike, sendTelegramMessage } from "../channels/telegram.js";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeFakeFetch(reply: { ok: boolean; status: number; body?: string } | (() => never)): {
  calls: CapturedCall[];
  fetch: FetchLike;
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (typeof reply === "function") {
      reply();
      throw new Error("unreachable");
    }
    return {
      ok: reply.ok,
      status: reply.status,
      text: async () => reply.body ?? "",
    };
  };
  return { calls, fetch: fetchImpl };
}

describe("sendTelegramMessage", () => {
  it("POSTs to the Telegram bot API with chat_id, text, parse_mode", async () => {
    const { calls, fetch } = makeFakeFetch({ ok: true, status: 200, body: '{"ok":true}' });
    const res = await sendTelegramMessage({ botToken: "123:abc", chatId: "555" }, "*hello*", fetch);
    expect(res).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.telegram.org/bot123%3Aabc/sendMessage");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body).toMatchObject({
      chat_id: "555",
      text: "*hello*",
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  });

  it("returns ok:false with status + error body on non-2xx response", async () => {
    const { fetch } = makeFakeFetch({ ok: false, status: 400, body: "bad request" });
    const res = await sendTelegramMessage({ botToken: "t", chatId: "c" }, "hi", fetch);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toBe("bad request");
  });

  it("returns ok:false with the thrown error message when fetch rejects", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };
    const res = await sendTelegramMessage({ botToken: "t", chatId: "c" }, "hi", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network down");
  });

  it("URL-encodes the bot token so a `:` is escaped", async () => {
    const { calls, fetch } = makeFakeFetch({ ok: true, status: 200 });
    await sendTelegramMessage({ botToken: "abc:def/ghi", chatId: "1" }, "x", fetch);
    expect(calls[0]?.url).toBe("https://api.telegram.org/botabc%3Adef%2Fghi/sendMessage");
  });

  // v0.35.0 — inline buttons
  it("attaches reply_markup.inline_keyboard when inlineActions + correlationId are set", async () => {
    const { calls, fetch } = makeFakeFetch({ ok: true, status: 200 });
    await sendTelegramMessage({ botToken: "t", chatId: "c" }, "approval needed", fetch, {
      inlineActions: [
        { id: "allow_once", label: "✓ Allow" },
        { id: "reject_once", label: "✕ Deny" },
      ],
      correlationId: "sessA-short:apprB-short",
    });
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "✓ Allow", callback_data: "polaris:sessA-short:apprB-short:allow_once" },
          { text: "✕ Deny", callback_data: "polaris:sessA-short:apprB-short:reject_once" },
        ],
      ],
    });
  });

  // v0.35.0 — Telegram caps callback_data at 64 bytes. Two full v4 UUIDs
  // (36 chars each) would overflow, so each id is truncated to 16 chars.
  it("truncates each correlationId half to 16 chars to stay under the 64-byte cap", async () => {
    const { calls, fetch } = makeFakeFetch({ ok: true, status: 200 });
    const sessionId = "b9c1ce92-1b1f-4f3e-aa17-1f44c4f7c0a4";
    const approvalId = "5b54a7a7-7b3a-4d1c-9e26-3b1b6e0c9b09";
    await sendTelegramMessage({ botToken: "t", chatId: "c" }, "approval needed", fetch, {
      inlineActions: [{ id: "allow_once", label: "✓ Allow" }],
      correlationId: `${sessionId}:${approvalId}`,
    });
    const body = JSON.parse(calls[0]?.body ?? "{}");
    const cb = body.reply_markup.inline_keyboard[0][0].callback_data;
    expect(cb).toBe(`polaris:${sessionId.slice(0, 16)}:${approvalId.slice(0, 16)}:allow_once`);
    // Sanity: under Telegram's 64-byte cap.
    expect(cb.length).toBeLessThanOrEqual(64);
  });

  it("omits reply_markup when inlineActions is empty or correlationId is missing", async () => {
    const { calls, fetch } = makeFakeFetch({ ok: true, status: 200 });
    await sendTelegramMessage({ botToken: "t", chatId: "c" }, "hi", fetch, {
      inlineActions: [],
      correlationId: "x",
    });
    expect(JSON.parse(calls[0]?.body ?? "{}").reply_markup).toBeUndefined();
    await sendTelegramMessage({ botToken: "t", chatId: "c" }, "hi", fetch, {
      inlineActions: [{ id: "x", label: "X" }],
    });
    expect(JSON.parse(calls[1]?.body ?? "{}").reply_markup).toBeUndefined();
  });
});
