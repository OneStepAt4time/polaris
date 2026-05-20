export interface ChannelResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface Channel {
  /** Human-readable channel name for logging (e.g. "telegram", "slack"). */
  readonly name: string;
  send(text: string): Promise<ChannelResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
