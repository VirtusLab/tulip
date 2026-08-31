import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { config } from "../config.js";
import { createLogger } from "../logging/logger.js";
import { verifyMermaidDiagrams } from "./mermaid-verify.js";

const MAX_ATTEMPTS = config.limits.maxMermaidFixAttempts;

// A realistic LLM slip: mismatched node-shape delimiters (bracket opened, never closed before
// the arrow) — the same category of error that produced the real "Syntax error in text" the
// browser showed (see docs/adr/0008's context).
const INVALID_DIAGRAM = "graph TD\nA[Start --> B{Decision\nB -->|Yes] C[End]";
const VALID_DIAGRAM = "graph TD\nA --> B";
// Labeled — the real production regression (docs/adr/0008's amendment) was specific to
// labeled diagrams (almost every real LLM-produced one); this proves a valid one survives
// the verify loop completely untouched, not just an unlabeled toy case.
const VALID_LABELED_DIAGRAM = "graph TD\nA[Start] --> B{Decision}\nB -->|Yes| C[End]";
const OTHER_VALID_DIAGRAM = "sequenceDiagram\nAlice->>Bob: Hello";

function envelope(structuredOutput: unknown, sessionId: string): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: structuredOutput,
    }),
    stderr: "",
  };
}

function withFence(source: string): string {
  return `intro\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\noutro`;
}

describe("verifyMermaidDiagrams", () => {
  it("leaves a valid diagram untouched and makes no LLM call", async () => {
    const markdown = withFence(VALID_DIAGRAM);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(result).toEqual({ markdown, sessionId: "session-1" });
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("leaves a valid LABELED diagram untouched, not fixed or omitted, and makes no LLM call", async () => {
    // The real production bug (docs/adr/0008's amendment) false-rejected labeled diagrams —
    // almost every real one — which would have sent them through the fix loop and then, once
    // fix attempts were exhausted, silently dropped good diagrams. This proves that can't
    // happen: a valid labeled diagram is left byte-for-byte alone.
    const markdown = withFence(VALID_LABELED_DIAGRAM);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(result).toEqual({ markdown, sessionId: "session-1" });
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("leaves multiple valid diagrams of different kinds untouched", async () => {
    const markdown = `${withFence(VALID_DIAGRAM)}\n\n${withFence(OTHER_VALID_DIAGRAM)}`;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(result.markdown).toBe(markdown);
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("resumes the explaining session with the invalid source and error, then replaces the fence with the fix", async () => {
    const markdown = withFence(INVALID_DIAGRAM);
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      expect(input).toContain(INVALID_DIAGRAM);
      expect(input).toMatch(/parse error/i);
      return envelope({ source: VALID_DIAGRAM }, "explain-session-2");
    });

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe("explain-session-2");
    expect(result.markdown).toContain(VALID_DIAGRAM);
    expect(result.markdown).not.toContain(INVALID_DIAGRAM);
    expect(result.markdown).toContain("intro");
    expect(result.markdown).toContain("outro");
  });

  it("feeds the still-invalid fix's own error into the next attempt", async () => {
    const markdown = withFence(INVALID_DIAGRAM);
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        expect(input).toContain(INVALID_DIAGRAM);
        return envelope({ source: "still broken [[[" }, "explain-2");
      }
      expect(input).toContain("still broken [[[");
      return envelope({ source: VALID_DIAGRAM }, "explain-3");
    });

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    expect(result.markdown).toContain(VALID_DIAGRAM);
    expect(result.sessionId).toBe("explain-3");
  });

  it("degrades to an inline note and logs a warning once fix attempts are exhausted", async () => {
    const markdown = withFence(INVALID_DIAGRAM);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ source: "still not valid [[[" }, "explain-fix"),
    );
    const write = vi.fn();
    const logger = createLogger({ write });

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
      logger,
    });

    expect(runClaudeProcess).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result.markdown).not.toContain("```mermaid");
    expect(result.markdown).not.toContain(INVALID_DIAGRAM);
    expect(result.markdown).toContain("omitted");
    expect(result.markdown).toContain("intro");
    expect(result.markdown).toContain("outro");

    const lines = write.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => /warning.*Retry logic.*omitting it/i.test(line))).toBe(true);
  });

  it("only fixes the invalid diagram among several, leaving valid ones untouched", async () => {
    const markdown = `${withFence(VALID_DIAGRAM)}\n\n${withFence(INVALID_DIAGRAM)}\n\n${withFence(OTHER_VALID_DIAGRAM)}`;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      expect(input).toContain(INVALID_DIAGRAM);
      return envelope({ source: "graph TD\nX --> Y" }, "explain-2");
    });

    const result = await verifyMermaidDiagrams(markdown, "session-1", "Retry logic", {
      runClaudeProcess,
    });

    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain(VALID_DIAGRAM);
    expect(result.markdown).toContain(OTHER_VALID_DIAGRAM);
    expect(result.markdown).toContain("graph TD\nX --> Y");
    expect(result.markdown).not.toContain(INVALID_DIAGRAM);
  });
});
