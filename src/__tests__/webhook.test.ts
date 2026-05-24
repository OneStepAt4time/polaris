import { describe, expect, it } from "vitest";
import type { FetchLike } from "../channels/channel.js";
import { sendWebhookMessage } from "../channels/webhook.js";
import { parseTelegramEnv } from "../config.js";

interface Capture {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeFetch(reply: { ok: boolean; status: number; body?: string }): {
  calls: Capture[];
  fetch: FetchLike;
} {
  const calls: Capture[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      return {
        ok: reply.ok,
        status: reply.status,
        text: async () => reply.body ?? "",
      };
    },
  };
}

describe("sendWebhookMessage", () => {
  it("POSTs a {rule, dedupKey, message, source} JSON payload to the URL", async () => {
    const { calls, fetch } = makeFetch({ ok: true, status: 200 });
    const res = await sendWebhookMessage(
      { url: "https://example.com/hook" },
      "*Polaris* — alert",
      fetch,
    );
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.com/hook");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.message).toBe("*Polaris* — alert");
    expect(body.source).toBe("polaris");
    expect(body.rule).toBe("polaris");
    expect(body.dedupKey).toBe("");
  });

  it("returns ok:false with the response body on non-2xx", async () => {
    const { fetch } = makeFetch({ ok: false, status: 500, body: "server boom" });
    const res = await sendWebhookMessage({ url: "https://x" }, "hi", fetch);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toContain("server boom");
  });

  it("returns ok:false with the thrown message on network error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("dns fail");
    };
    const res = await sendWebhookMessage({ url: "https://x" }, "hi", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("dns fail");
  });
});

describe("parseTelegramEnv", () => {
  it("returns null on empty input", () => {
    expect(parseTelegramEnv("")).toBeNull();
  });
  it("returns null on missing separator", () => {
    expect(parseTelegramEnv("just-a-token")).toBeNull();
  });
  it("splits at the LAST pipe so bot tokens with colons stay intact", () => {
    // Real Telegram bot tokens look like "123456789:ABC-DEF-1234"
    const result = parseTelegramEnv("123456789:ABC-DEF-1234|987654321");
    expect(result?.botToken).toBe("123456789:ABC-DEF-1234");
    expect(result?.chatId).toBe("987654321");
  });
  it("trims whitespace around the parts", () => {
    expect(parseTelegramEnv("  tok  |  chat  ")).toEqual({
      botToken: "tok",
      chatId: "chat",
    });
  });
  it("returns null when either part is empty", () => {
    expect(parseTelegramEnv("|chat")).toBeNull();
    expect(parseTelegramEnv("tok|")).toBeNull();
  });
});
