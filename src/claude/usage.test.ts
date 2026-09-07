import { describe, expect, it } from "vitest";
import { createUsageLedger, formatUsageSummary } from "./usage.js";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  };
}

describe("createUsageLedger", () => {
  it("accumulates per model across calls", () => {
    const ledger = createUsageLedger();
    ledger.record({ model: "opus" }, { session_id: "s1", usage: usage(100, 20, 5, 3) });
    ledger.record({ model: "opus" }, { session_id: "s2", usage: usage(50, 10, 1, 2) });
    ledger.record({ model: "haiku" }, { session_id: "s3", usage: usage(7, 8) });

    expect(ledger.rows()).toEqual([
      { model: "haiku", tokens: { input: 7, output: 8, cacheWrite: 0, cacheRead: 0 } },
      { model: "opus", tokens: { input: 150, output: 30, cacheWrite: 5, cacheRead: 6 } },
    ]);
  });

  it("orders rows sonnet, haiku, opus and omits unused models", () => {
    const ledger = createUsageLedger();
    ledger.record({ model: "opus" }, { session_id: "s1", usage: usage(1, 1) });
    ledger.record({ model: "sonnet" }, { session_id: "s2", usage: usage(1, 1) });

    expect(ledger.rows().map((r) => r.model)).toEqual(["sonnet", "opus"]);
  });

  it("attributes a resumed session to the model it was started with", () => {
    const ledger = createUsageLedger();
    ledger.record({ model: "sonnet" }, { session_id: "s1", usage: usage(100, 0) });
    // A resume carries no model — it must land under the originating session's model.
    ledger.record({ resumeSessionId: "s1" }, { session_id: "s1", usage: usage(40, 10) });

    expect(ledger.rows()).toEqual([
      { model: "sonnet", tokens: { input: 140, output: 10, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("files a resume of an unrecorded session under 'unknown'", () => {
    const ledger = createUsageLedger();
    ledger.record({ resumeSessionId: "never-seen" }, { session_id: "s1", usage: usage(5, 5) });

    expect(ledger.rows()).toEqual([
      { model: "unknown", tokens: { input: 5, output: 5, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("treats missing or non-numeric usage fields as zero, never throwing", () => {
    const ledger = createUsageLedger();
    ledger.record({ model: "haiku" }, { session_id: "s1", usage: undefined });
    ledger.record({ model: "haiku" }, { session_id: "s2", usage: { input_tokens: "lots" } });
    ledger.record({ model: "haiku" }, { session_id: "s3", usage: usage(3, 0) });

    expect(ledger.rows()).toEqual([
      { model: "haiku", tokens: { input: 3, output: 0, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });
});

describe("formatUsageSummary", () => {
  it("returns an empty string for an empty ledger", () => {
    expect(formatUsageSummary(createUsageLedger())).toBe("");
  });

  it("renders a per-model table with a totals row, pinning each column's value", () => {
    const ledger = createUsageLedger();
    // usage(input, output, cacheRead, cacheWrite)
    ledger.record(
      { model: "sonnet" },
      { session_id: "s1", usage: usage(12345, 6789, 40000, 2000) },
    );
    ledger.record(
      { model: "opus" },
      { session_id: "s2", usage: usage(98765, 43210, 500000, 12000) },
    );

    const lines = formatUsageSummary(ledger).split("\n");
    // Splitting a row on whitespace yields its columns in order — pins the Cache-write-before-
    // Cache-read mapping a `.toContain` check couldn't (both numbers would match either way).
    const cells = (label: string) =>
      lines
        .find((l) => l.trim().startsWith(label))
        ?.trim()
        .split(/\s+/);

    expect(lines[0]).toBe("Token usage");
    expect(lines[1]).toMatch(/Model\s+Input\s+Output\s+Cache write\s+Cache read/);
    // Columns: Model, Input, Output, Cache write (cache_creation), Cache read (cache_read).
    expect(cells("sonnet")).toEqual(["sonnet", "12,345", "6,789", "2,000", "40,000"]);
    expect(cells("opus")).toEqual(["opus", "98,765", "43,210", "12,000", "500,000"]);
    expect(cells("total")).toEqual(["total", "111,110", "49,999", "14,000", "540,000"]);
  });
});
