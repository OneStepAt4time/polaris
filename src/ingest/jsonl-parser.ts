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
  /** Lines added by Edit/Write/MultiEdit tool calls on this event. v0.23.0. */
  linesAdded: number;
  /** Lines removed by Edit/MultiEdit tool calls on this event. v0.23.0. */
  linesRemoved: number;
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
    content?: unknown;
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
  const lines = extractToolLineCounts(raw.message?.content);
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
    linesAdded: lines.added,
    linesRemoved: lines.removed,
  };
}

interface LineCounts {
  added: number;
  removed: number;
}

interface ToolUseBlock {
  type?: unknown;
  name?: unknown;
  input?: unknown;
}

/**
 * Walk the assistant message content for Edit / Write / MultiEdit tool_use
 * blocks and sum their lines added/removed. Mirrors how CCMeter counts
 * acceptance metrics: a "line" is one '\n'-separated chunk of the
 * old_string / new_string / content payload. Empty trailing newline is
 * stripped so a one-line edit counts as 1, not 2.
 */
export function extractToolLineCounts(content: unknown): LineCounts {
  let added = 0;
  let removed = 0;
  if (!Array.isArray(content)) return { added, removed };
  for (const block of content as ToolUseBlock[]) {
    if (block === null || typeof block !== "object" || block.type !== "tool_use") continue;
    const name = typeof block.name === "string" ? block.name : "";
    const input = block.input;
    if (input === null || typeof input !== "object") continue;
    const i = input as Record<string, unknown>;
    if (name === "Edit") {
      if (typeof i.old_string === "string") removed += countLines(i.old_string);
      if (typeof i.new_string === "string") added += countLines(i.new_string);
    } else if (name === "Write") {
      if (typeof i.content === "string") added += countLines(i.content);
    } else if (name === "MultiEdit") {
      if (Array.isArray(i.edits)) {
        for (const edit of i.edits as Array<Record<string, unknown>>) {
          if (typeof edit.old_string === "string") removed += countLines(edit.old_string);
          if (typeof edit.new_string === "string") added += countLines(edit.new_string);
        }
      }
    } else if (name === "NotebookEdit") {
      if (typeof i.new_source === "string") added += countLines(i.new_source);
    }
  }
  return { added, removed };
}

function countLines(s: string): number {
  if (s === "") return 0;
  const stripped = s.endsWith("\n") ? s.slice(0, -1) : s;
  return stripped.split("\n").length;
}
