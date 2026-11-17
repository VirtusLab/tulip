import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "../logging/logger.js";
import type { ModelTier, ModelTokens } from "./types.js";

/** What a session call is for, so its record can be grouped by pipeline step when analysed. */
export interface CallLabel {
  /** Pipeline step, e.g. "explain" or "review-amend". */
  step: string;
  /** Name of the category the call works on, if any. */
  category?: string;
  /** 1-based batch number, for steps that run in batches. */
  batch?: number;
  /** 1-based attempt number, for steps that repeat until a check passes. */
  attempt?: number;
}

/** One agent CLI process run. */
export interface CallRecord {
  type: "call";
  label: CallLabel;
  /** True for the runner's re-ask after a reply that didn't match the schema. */
  schemaRetry: boolean;
  backend: string;
  /** Absent for a resume of a session that was never recorded. */
  tier?: ModelTier;
  model?: string;
  /** Session the call resumed; absent for a fresh session. */
  resumedFrom?: string;
  /** Absent when the process failed. */
  sessionId?: string;
  promptChars: number;
  /** Wall time of the process itself, excluding the wait for a free concurrency slot. */
  wallMs: number;
  /** As reported by the CLI; absent when it doesn't report them. */
  tokens?: ModelTokens;
  numTurns?: number;
  costUsd?: number;
  /** Set when the process failed, or its reply couldn't be parsed or didn't match the schema. */
  error?: string;
}

/** The PR a run explains; written once its diff is fetched. */
export interface RunRecord {
  type: "run";
  version: string;
  agent: string;
  pr: string;
  files: number;
  changes: number;
  diffLines: number;
  diffThreshold: number;
}

/** The final categories, written once classification is done. */
export interface CategoriesRecord {
  type: "categories";
  categories: { name: string; attention: string; production: number; test: number }[];
}

/** How a run ended; `wallMs` excludes the time a `--serve` review server stays open. */
export interface EndRecord {
  type: "end";
  ok: boolean;
  wallMs: number;
  error?: string;
}

/** Any record written to a call log. Every record also gets an ISO `time` when written. */
export type CallLogRecord = CallRecord | RunRecord | CategoriesRecord | EndRecord;

/** Collects per-call statistics of one run, for later cost analysis. */
export interface CallLog {
  /** Path of the JSONL file, one record per line. */
  readonly path: string;
  record(record: CallLogRecord): void;
}

/**
 * Creates a call log appending to a new JSONL file in the OS temp dir. Records are written as they
 * come, so a failed run keeps what it logged. Write failures never fail the run: the first one is
 * logged and later records are dropped.
 */
export function createCallLog(logger: Logger, now: () => Date = () => new Date()): CallLog {
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const path = join(tmpdir(), `tulip-calls-${stamp}-${process.pid}.jsonl`);
  let failed = false;

  function record(entry: CallLogRecord): void {
    if (failed) {
      return;
    }
    try {
      appendFileSync(path, `${JSON.stringify({ time: now().toISOString(), ...entry })}\n`);
    } catch (error) {
      failed = true;
      logger.info(
        `warning: couldn't write the call log ${path}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return { path, record };
}
