import type { ModelTier, ModelTokens } from "./types.js";

/** "unknown" is the summary label for a resume whose originating session was never recorded.
 * The real pipeline always records a session before resuming it, so it can't arise there; it
 * exists only so a partial/future caller can't silently drop token counts. */
const UNKNOWN_MODEL = "unknown";

/** One model's row in the summary, labelled with the backend's own model id. */
export interface ModelUsageRow {
  model: string;
  tokens: ModelTokens;
}

/** Which model one call ran on: its tier and the backend's model id for it. */
export interface UsageCall {
  tier: ModelTier;
  model: string;
}

/**
 * Accumulates agent token usage per model across a run, so the pipeline can print a summary at
 * the end (see src/pipeline/run.ts). One ledger is shared by every phase (threaded via
 * `RunnerDeps.usage`); {@link invokeAgent} calls {@link UsageLedger.record} once per process
 * invocation, including retries — a resume is attributed to its session's model.
 */
export interface UsageLedger {
  /** Adds one invocation's tokens to its model's totals. `usage` is that one invocation's tokens
   * (not a running session total), so summing across calls is correct; `undefined` means the CLI
   * didn't report any, counted by {@link unreportedCalls} instead. `call` is `undefined` for a
   * resume of an unrecorded session, totalled as "unknown". */
  record(call: UsageCall | undefined, usage: ModelTokens | undefined): void;
  /** Per-model totals, ordered by tier (balanced, fast, strong), then unknown — only models
   * actually used. */
  rows(): ModelUsageRow[];
  /** Calls whose reply carried no usage at all. */
  unreportedCalls(): number;
}

/** Row order by tier; models never used are omitted. */
const TIER_ORDER: ModelTier[] = ["balanced", "fast", "strong"];

export function createUsageLedger(): UsageLedger {
  const totals = new Map<string, { tier: ModelTier | undefined; tokens: ModelTokens }>();
  let unreported = 0;

  function record(call: UsageCall | undefined, usage: ModelTokens | undefined): void {
    if (usage === undefined) {
      unreported++;
      return;
    }
    const model = call?.model ?? UNKNOWN_MODEL;
    const entry = totals.get(model) ?? {
      tier: call?.tier,
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    entry.tokens.input += usage.input;
    entry.tokens.output += usage.output;
    entry.tokens.cacheWrite += usage.cacheWrite;
    entry.tokens.cacheRead += usage.cacheRead;
    totals.set(model, entry);
  }

  function rank(tier: ModelTier | undefined): number {
    return tier === undefined ? TIER_ORDER.length : TIER_ORDER.indexOf(tier);
  }

  function rows(): ModelUsageRow[] {
    return [...totals.entries()]
      .sort(([, a], [, b]) => rank(a.tier) - rank(b.tier))
      .map(([model, { tokens }]) => ({ model, tokens }));
  }

  return { record, rows, unreportedCalls: () => unreported };
}

// "Uncached in" is only the fresh input of a turn (see `ModelTokens`); the cached bulk of the
// input is in the Cache write/read columns, not here.
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
