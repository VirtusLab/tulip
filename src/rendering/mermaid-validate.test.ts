import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { validateMermaidDiagram } from "./mermaid-validate.js";

const execFileAsync = promisify(execFile);

/**
 * No `@vitest-environment jsdom` header (unlike ../rendering/highlight-safety.test.ts) —
 * deliberately runs under vitest's default plain-Node environment, matching the exact
 * conditions production hits (the CLI runs in plain Node, with no browser-like globals) more
 * closely than a jsdom environment would.
 *
 * This alone is *not* a reliable regression guard for the bug described below, though — vitest's
 * own module runner doesn't deterministically reproduce plain Node's ES module evaluation order
 * (confirmed while diagnosing it: the exact same pre-fix source passed here depending on unrelated
 * details of which case ran first in the file, while failing as a lone/first case). The
 * `describe` block below this one spawns a real child process instead, which does reproduce it
 * reliably — that's the actual regression guard; this block is functional coverage of the
 * contract, using richer/more realistic diagram content than before.
 */
describe("validateMermaidDiagram", () => {
  it("accepts a valid, labeled flowchart", async () => {
    const result = await validateMermaidDiagram(
      "graph TD\nA[Start] --> B{Decision}\nB -->|Yes| C[End]",
    );
    expect(result).toEqual({ valid: true });
  });

  it("accepts a valid unlabeled flowchart", async () => {
    const result = await validateMermaidDiagram("graph TD\nA --> B");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a valid, labeled sequence diagram", async () => {
    const result = await validateMermaidDiagram(
      "sequenceDiagram\nparticipant Alice\nparticipant Bob\n" +
        "Alice->>Bob: Hello Bob, how are you?\nBob-->>Alice: Great!",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a valid class diagram with member content", async () => {
    const result = await validateMermaidDiagram(
      "classDiagram\nclass Animal{\n+String name\n+makeSound()\n}\nAnimal <|-- Dog",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a valid pie chart with content", async () => {
    const result = await validateMermaidDiagram('pie title Pets\n"Dogs" : 40\n"Cats" : 60');
    expect(result.valid).toBe(true);
  });

  it("accepts a valid state diagram with content", async () => {
    const result = await validateMermaidDiagram(
      "stateDiagram-v2\n[*] --> Idle\nIdle --> Running: start\nRunning --> [*]: stop",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a genuinely broken flowchart (a realistic LLM slip: mismatched node delimiters)", async () => {
    const bad = "graph TD\nA[Start --> B{Decision\nB -->|Yes] C[End]";
    const result = await validateMermaidDiagram(bad);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/parse error/i);
  });

  it("rejects text that isn't a recognizable diagram at all", async () => {
    const result = await validateMermaidDiagram("this is not a diagram at all !!! ???");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validates concurrently without cross-talk between calls", async () => {
    const cases: [string, boolean][] = [
      ["graph TD\nA[Start] --> B{Decision}\nB -->|Yes| C[End]", true],
      ["sequenceDiagram\nAlice->>Bob: Hi", true],
      ["classDiagram\nclass Animal{\n+String name\n}\nAnimal <|-- Dog", true],
      ['pie title P\n"A" : 1\n"B" : 2', true],
      ["stateDiagram-v2\n[*] --> Idle\nIdle --> [*]", true],
      ["graph TD\nA[Start --> B{Bad", false],
      ["not a diagram", false],
      ["graph TD\nA --> B --> C", true],
    ];

    const results = await Promise.all(cases.map(([source]) => validateMermaidDiagram(source)));

    results.forEach((result, i) => {
      expect(result.valid).toBe(cases[i]?.[1]);
    });
  });
});

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TSX_BIN = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const MERMAID_VALIDATE_TS = join(import.meta.dirname, "mermaid-validate.ts");

/**
 * Runs `cases` against a *real, fresh `node` process* (via `tsx`, which only strips types —
 * it doesn't alter import semantics/order), started with none of vitest's own module machinery
 * involved at all. This is what actually matches "how the CLI runs" (`node dist/...`): plain
 * Node's real ES module evaluation order, where a statically-imported package's top-level side
 * effects (here: `mermaid` importing `dompurify`, which constructs its singleton immediately,
 * capturing whatever `window` exists *at that moment*) run before anything else in the importing
 * module — see docs/adr/0008's amendment for the bug this guards against.
 */
async function runInChildProcess(cases: string[]): Promise<{ valid: boolean; error?: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), "tulip-mermaid-validate-"));
  const scriptPath = join(dir, "check.mjs");
  const script = `
    import { validateMermaidDiagram } from ${JSON.stringify(MERMAID_VALIDATE_TS)};
    const cases = ${JSON.stringify(cases)};
    const results = [];
    for (const source of cases) {
      results.push(await validateMermaidDiagram(source));
    }
    process.stdout.write(JSON.stringify(results));
  `;
  try {
    await writeFile(scriptPath, script, "utf8");
    const { stdout } = await execFileAsync(TSX_BIN, [scriptPath], {
      cwd: PROJECT_ROOT,
      timeout: 30_000,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("validateMermaidDiagram, in a real child process (no vitest/vite module transform)", () => {
  it("accepts labeled diagrams of every kind tested above, and still rejects a broken one — exactly as production runs it", async () => {
    const cases = [
      "graph TD\nA[Start] --> B{Decision}\nB -->|Yes| C[End]",
      "sequenceDiagram\nAlice->>Bob: Hello Bob, how are you?",
      "classDiagram\nclass Animal{\n+String name\n+makeSound()\n}\nAnimal <|-- Dog",
      'pie title Pets\n"Dogs" : 40\n"Cats" : 60',
      "stateDiagram-v2\n[*] --> Idle\nIdle --> Running: start\nRunning --> [*]: stop",
      "graph TD\nA[Start --> B{Decision\nB -->|Yes] C[End]",
    ];

    const results = await runInChildProcess(cases);

    expect(results.slice(0, 5)).toEqual([
      { valid: true },
      { valid: true },
      { valid: true },
      { valid: true },
      { valid: true },
    ]);
    expect(results[5]?.valid).toBe(false);
    expect(results[5]?.error).toMatch(/parse error/i);
  }, 30_000);
});
