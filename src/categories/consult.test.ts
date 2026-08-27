import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { type ConsultCategoryInput, consultOnCategory } from "./consult.js";

const INPUT: ConsultCategoryInput = {
  sessionId: "session-1",
  proposedName: "Config parsing",
  change: {
    path: "src/config.ts",
    range: { start: 10, end: 24 },
    excerpt: "+ export function parseConfig(raw: string): Config { ... }",
  },
};

function envelope(structuredOutput: unknown, sessionId = "session-1"): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: structuredOutput,
    }),
    stderr: "",
  };
}

describe("consultOnCategory", () => {
  it("requests a schema shaped as { accept, category? }", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ accept: false }));

    await consultOnCategory(INPUT, { runClaudeProcess });

    const args = runClaudeProcess.mock.calls[0]?.[0] as string[];
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "{}");
    expect(schema).toEqual({
      type: "object",
      required: ["accept"],
      properties: {
        accept: { type: "boolean" },
        category: {
          type: "object",
          required: ["name", "description"],
          properties: { name: { type: "string" }, description: { type: "string" } },
        },
      },
    });
  });

  it("resumes the phase-1 session with the proposed name and change context", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ accept: false }));

    await consultOnCategory(INPUT, { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain(INPUT.proposedName);
    expect(prompt).toContain(INPUT.change.path);
    expect(prompt).toContain("10-24");
    expect(prompt).toContain(INPUT.change.excerpt);
    expect(args).toContain("--resume");
    expect((args as string[])[(args as string[]).indexOf("--resume") + 1]).toBe(INPUT.sessionId);
  });

  it("returns accept: true with the (possibly refined) category", async () => {
    const category = { name: "Config parsing", description: "Parses the config file." };
    const runClaudeProcess = vi.fn(async () => envelope({ accept: true, category }));

    const result = await consultOnCategory(INPUT, { runClaudeProcess });

    expect(result).toEqual({ accept: true, category });
  });

  it("returns accept: false without a category on rejection", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ accept: false }));

    const result = await consultOnCategory(INPUT, { runClaudeProcess });

    expect(result).toEqual({ accept: false });
  });
});
