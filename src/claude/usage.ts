import type { ClaudeModel } from "./runner.js";

/**
 * One model's accumulated token counts, matching Anthropic's usage object. `cacheWrite`/
 * `cacheRead` are its two prompt-cache fields — both input-side (there is no cached output):
 * `cacheWrite` = cache_creation_input_tokens (input written into the cache), `cacheRead` =
 * cache_read_input_tokens (input served from the cache). `input`/`output` are the ordinary
 * (uncached) input and output token counts.
 */
export interface ModelTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** A model label as it appears in the summary — a known {@link ClaudeModel}, or the defensive
 * "unknown" fallback for a resume whose originating session was never recorded. The real pipeline
 * always records a session before resuming it, so "unknown" can't arise there; it exists only so a
 * partial/future caller can't silently drop token counts. */
export type UsageModel = ClaudeModel | "unknown";

/** One model's row in the summary. */
export interface ModelUsageRow {
  model: UsageModel;
  tokens: ModelTokens;
}

/** The invocation fields {@link UsageLedger.record} needs to attribute usage to a model: a fresh
 * call carries `model`; a resume carries `resumeSessionId`, whose model the ledger looks up. */
export interface UsageInvocation {
  model?: ClaudeModel;
  resumeSessionId?: string;
}

/** The envelope fields {@link UsageLedger.record} reads: the (possibly new) session id and the
 * raw `usage` object, parsed defensively. */
export interface UsageEnvelope {
  session_id: string;
  usage?: unknown;
}

/**
 * Accumulates `claude` token usage per model across a run, so the pipeline can print a summary at
 * the end (see src/pipeline/run.ts). One ledger is shared by every phase (threaded via
 * `RunnerDeps.usage`); {@link invokeClaude} calls {@link UsageLedger.record} once per process
 * invocation, including retries.
 */
export interface UsageLedger {
  /** Attributes one invocation's `usage` to its model and adds it to that model's totals. A
   * fresh call's model comes from `invocation.model`; a resume's from the session that started it
   * (tracked internally), so amend/retry turns land under the right model. Assumes each envelope's
   * `usage` is that one invocation's tokens (not a running session total), so summing across calls
   * is correct — the shape of `claude --output-format json`'s per-turn `usage`. */
  record(invocation: UsageInvocation, envelope: UsageEnvelope): void;
  /** Per-model totals, ordered sonnet, haiku, opus, then unknown — only models actually used. */
  rows(): ModelUsageRow[];
}

/** Fixed display order; models never used are omitted from the summary. */
const MODEL_ORDER: UsageModel[] = ["sonnet", "haiku", "opus", "unknown"];

export function createUsageLedger(): UsageLedger {
  const totals = new Map<UsageModel, ModelTokens>();
  // Remembers each session's model so a `--resume` invocation (which carries no `--model`) is
  // attributed to the model its session was started with.
  const sessionModel = new Map<string, UsageModel>();

  function record(invocation: UsageInvocation, envelope: UsageEnvelope): void {
    const model =
      invocation.model ??
      (invocation.resumeSessionId ? sessionModel.get(invocation.resumeSessionId) : undefined) ??
      "unknown";
    sessionModel.set(envelope.session_id, model);

    const parsed = parseUsage(envelope.usage);
    const acc = totals.get(model) ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    acc.input += parsed.input;
    acc.output += parsed.output;
    acc.cacheWrite += parsed.cacheWrite;
    acc.cacheRead += parsed.cacheRead;
    totals.set(model, acc);
  }

  function rows(): ModelUsageRow[] {
    return MODEL_ORDER.filter((model) => totals.has(model)).map((model) => ({
      model,
      tokens: totals.get(model) as ModelTokens,
    }));
  }

  return { record, rows };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Reads the four token counts from a `claude` usage object, defaulting anything missing or
 * non-numeric to 0 — so an unexpected/renamed field degrades to a 0 rather than a crash. */
function parseUsage(usage: unknown): ModelTokens {
  if (typeof usage !== "object" || usage === null) {
    return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  }
  const u = usage as Record<string, unknown>;
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
  };
}

// "Uncached in" is Anthropic's `input_tokens` — only the fresh input of a turn; the cached bulk
// of the input is in the Cache write/read columns, not here.
const COLUMNS = ["Model", "Uncached in", "Output", "Cache write", "Cache read"] as const;

/** Two-space indent so rows sit under the flush-left "Token usage" title; three-space gap between
 * columns. */
const TABLE_INDENT = "  ";
const COLUMN_GAP = "   ";

/**
 * Formats a ledger as an aligned token table (model left-aligned, counts right-aligned) with a
 * totals row, e.g.:
 *
 *   Token usage
 *     Model    Uncached in   Output   Cache write   Cache read
 *     sonnet        12,345    6,789         2,000       40,000
 *     opus          98,765   43,210        12,000      500,000
 *     total        111,110   49,999        14,000      540,000
 *
 * Returns an empty string when nothing was recorded.
 */
export function formatUsageSummary(ledger: UsageLedger): string {
  const rows = ledger.rows();
  if (rows.length === 0) {
    return "";
  }

  const total: ModelTokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const { tokens } of rows) {
    total.input += tokens.input;
    total.output += tokens.output;
    total.cacheWrite += tokens.cacheWrite;
    total.cacheRead += tokens.cacheRead;
  }

  const cells = [
    ...rows.map(({ model, tokens }) => [model, ...formatCounts(tokens)]),
    ["total", ...formatCounts(total)],
  ];

  const widths = COLUMNS.map((header, col) =>
    Math.max(header.length, ...cells.map((row) => (row[col] as string).length)),
  );
  // The model column (col 0) is left-aligned; the numeric columns are right-aligned.
  const line = (row: readonly string[]) =>
    `${TABLE_INDENT}${row.map((cell, col) => pad(cell, widths[col] as number, col === 0)).join(COLUMN_GAP)}`;

  return ["Token usage", line(COLUMNS), ...cells.map(line)].join("\n");
}

function pad(cell: string, width: number, left: boolean): string {
  return left ? cell.padEnd(width) : cell.padStart(width);
}

/** The four token counts as locale-formatted strings, in COLUMNS order. */
function formatCounts(tokens: ModelTokens): string[] {
  return [tokens.input, tokens.output, tokens.cacheWrite, tokens.cacheRead].map((n) =>
    n.toLocaleString("en-US"),
  );
}
