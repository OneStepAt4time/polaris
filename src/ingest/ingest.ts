import type { PolarisDb } from "../db.js";
import { dedupByRequestId } from "./dedup.js";
import { parseJsonl } from "./jsonl-parser.js";

export interface IngestResult {
  sessionFile: string;
  parsed: number;
  skipped: number;
  duplicatesInBatch: number;
  inserted: number;
  duplicatesInDb: number;
}

export function ingest(db: PolarisDb, sessionFile: string, content: string): IngestResult {
  const { events, skipped } = parseJsonl(content, sessionFile);
  const { kept, duplicates: duplicatesInBatch } = dedupByRequestId(events);

  let inserted = 0;
  let duplicatesInDb = 0;
  for (const event of kept) {
    if (db.insertEvent(event)) {
      inserted += 1;
    } else {
      duplicatesInDb += 1;
    }
  }

  return {
    sessionFile,
    parsed: events.length,
    skipped,
    duplicatesInBatch,
    inserted,
    duplicatesInDb,
  };
}
