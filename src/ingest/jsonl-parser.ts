export interface NormalizedEvent {
  requestId: string;
  sessionFile: string;
  tsMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  rawCostUsd: number | null;
  lineUuid: string | null;
}

interface RawJsonlLine {
  timestamp?: string;
  type?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  costUSD?: number;
  requestId?: string;
  uuid?: string;
}

export interface ParseResult {
  events: NormalizedEvent[];
  skipped: number;
}

export function parseJsonl(content: string, sessionFile: string): ParseResult {
  const events: NormalizedEvent[] = [];
  let skipped = 0;
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let raw: RawJsonlLine;
    try {
      raw = JSON.parse(trimmed) as RawJsonlLine;
    } catch {
      skipped += 1;
      continue;
    }
    const event = extractEvent(raw, sessionFile);
    if (event === null) {
      skipped += 1;
      continue;
    }
    events.push(event);
  }
  return { events, skipped };
}

function extractEvent(raw: RawJsonlLine, sessionFile: string): NormalizedEvent | null {
  // Only assistant messages with a usage block are billed events.
  if (raw.type !== "assistant") return null;
  const usage = raw.message?.usage;
  const model = raw.message?.model;
  const requestId = raw.requestId;
  if (!usage || !model || !requestId) return null;
  const tsIso = raw.timestamp;
  if (!tsIso) return null;
  const tsMs = Date.parse(tsIso);
  if (Number.isNaN(tsMs)) return null;
  return {
    requestId,
    sessionFile,
    tsMs,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    rawCostUsd: raw.costUSD ?? null,
    lineUuid: raw.uuid ?? null,
  };
}
