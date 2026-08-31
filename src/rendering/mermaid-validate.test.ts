import { describe, expect, it } from "vitest";
import { validateMermaidDiagram } from "./mermaid-validate.js";

/**
 * No `@vitest-environment jsdom` header (unlike ../rendering/highlight-safety.test.ts) —
 * deliberately runs under vitest's default plain-Node environment, exercising the exact code
 * path production hits (the CLI runs in plain Node, with no browser-like globals), including
 * `validateMermaidDiagram`'s own on-demand jsdom setup.
 */
describe("validateMermaidDiagram", () => {
  it("accepts a valid flowchart", async () => {
    const result = await validateMermaidDiagram("graph TD\nA --> B");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a valid sequence diagram", async () => {
    const result = await validateMermaidDiagram(
      "sequenceDiagram\nAlice->>Bob: Hello Bob, how are you?",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a valid class diagram (exercises the DOMPurify/window dependency path)", async () => {
    // classDiagram, pie, and state diagrams route through DOMPurify's sanitizer at parse time,
    // which throws "DOMPurify.addHook is not a function" without a real `window` — this is the
    // case that would false-reject in plain Node without this module's jsdom setup.
    const result = await validateMermaidDiagram("classDiagram\nClass01 <|-- AveryLongClass : Cool");
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
      ["sequenceDiagram\nAlice->>Bob: Hi", true],
      ["classDiagram\nA <|-- B", true],
      ['pie title P\n"A" : 1\n"B" : 2', true],
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
