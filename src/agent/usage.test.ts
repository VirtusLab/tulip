import { describe, expect, it } from "vitest";
import type { ModelTokens } from "./types.js";
import { createUsageLedger, formatUsageSummary } from "./usage.js";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0): ModelTokens {
  return { input, output, cacheRead, cacheWrite };
}

const OPUS = { tier: "strong", model: "opus" } as const;
const SONNET = { tier: "balanced", model: "sonnet" } as const;
const HAIKU = { tier: "fast", model: "haiku" } as const;

describe("createUsageLedger", () => {
  it("accumulates per model across calls", () => {
    const ledger = createUsageLedger();
    ledger.record(OPUS, usage(100, 20, 5, 3));
    ledger.record(OPUS, usage(50, 10, 1, 2));
    ledger.record(HAIKU, usage(7, 8));

    expect(ledger.rows()).toEqual([
      { model: "haiku", tokens: { input: 7, output: 8, cacheWrite: 0, cacheRead: 0 } },
      { model: "opus", tokens: { input: 150, output: 30, cacheWrite: 5, cacheRead: 6 } },
    ]);
  });

  it("orders rows by tier (balanced, fast, strong), unknown last, and omits unused models", () => {
    const ledger = createUsageLedger();
    ledger.record(undefined, usage(1, 1));
    ledger.record(OPUS, usage(1, 1));
    ledger.record(SONNET, usage(1, 1));

    expect(ledger.rows().map((r) => r.model)).toEqual(["sonnet", "opus", "unknown"]);
  });

  it("files a call with no model under 'unknown'", () => {
    const ledger = createUsageLedger();
    ledger.record(undefined, usage(5, 5));

    expect(ledger.rows()).toEqual([
      { model: "unknown", tokens: { input: 5, output: 5, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("counts calls without usage as unreported, adding no row", () => {
    const ledger = createUsageLedger();
    ledger.record(HAIKU, undefined);
    ledger.record(HAIKU, undefined);

    expect(ledger.rows()).toEqual([]);
    expect(ledger.unreportedCalls()).toBe(2);
  });
});

describe("formatUsageSummary", () => {
  it("returns an empty string for an empty ledger", () => {
    expect(formatUsageSummary(createUsageLedger())).toBe("");
  });

  it("renders a per-model table with a totals row, pinning each column's value", () => {
    const ledger = createUsageLedger();
    // usage(input, output, cacheRead, cacheWrite)
    ledger.record(SONNET, usage(12345, 6789, 40000, 2000));
    ledger.record(OPUS, usage(98765, 43210, 500000, 12000));

    const lines = formatUsageSummary(ledger).split("\n");
    // Splitting a row on whitespace yields its columns in order — pins the Cache-write-before-
    // Cache-read mapping a `.toContain` check couldn't (both numbers would match either way).
    const cells = (label: string) =>
      lines
        .find((l) => l.trim().startsWith(label))
        ?.trim()
        .split(/\s+/);

    expect(lines[0]).toBe("Token usage");
    expect(lines[1]).toMatch(/Model\s+Uncached in\s+Output\s+Cache write\s+Cache read/);
    // Columns: Model, Input, Output, Cache write (cache_creation), Cache read (cache_read).
    expect(cells("sonnet")).toEqual(["sonnet", "12,345", "6,789", "2,000", "40,000"]);
    expect(cells("opus")).toEqual(["opus", "98,765", "43,210", "12,000", "500,000"]);
    expect(cells("total")).toEqual(["total", "111,110", "49,999", "14,000", "540,000"]);
  });
});
