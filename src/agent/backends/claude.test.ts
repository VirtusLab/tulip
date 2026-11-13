import { describe, expect, it } from "vitest";
import { AgentOutputError } from "../errors.js";
import type { JsonSchema } from "../schema.js";
import { claudeBackend } from "./claude.js";

const SCHEMA: JsonSchema = { type: "object" };

describe("claudeBackend.planSpawn", () => {
  it("grants read access to context dirs with --add-dir", async () => {
    const { args } = await claudeBackend.planSpawn({
      prompt: "p",
      schema: SCHEMA,
      model: "sonnet",
      contextDirs: ["/repos/protos", "/repos/product"],
    });

    expect(args).toEqual(
      expect.arrayContaining(["--add-dir", "/repos/protos", "/repos/product", "--model"]),
    );
    expect(args.indexOf("--add-dir") + 3).toBe(args.indexOf("--model"));
  });

  it("passes no --add-dir without context dirs", async () => {
    const { args } = await claudeBackend.planSpawn({
      prompt: "p",
      schema: SCHEMA,
      model: "sonnet",
    });

    expect(args).not.toContain("--add-dir");
  });
});

describe("claudeBackend.parseReply", () => {
  it("throws AgentOutputError when the envelope reports an error", () => {
    const stdout = JSON.stringify({ is_error: true, result: "boom", session_id: "s-1" });

    expect(() => claudeBackend.parseReply(stdout, SCHEMA)).toThrow(AgentOutputError);
    expect(() => claudeBackend.parseReply(stdout, SCHEMA)).toThrow(
      /claude reported an error: boom/,
    );
  });
});

describe("claudeBackend.describeFailure", () => {
  const describeFailure = (stdout: string) => claudeBackend.describeFailure?.(stdout);

  it("returns the envelope's result", () => {
    expect(
      describeFailure(
        JSON.stringify({ is_error: true, result: "model not found", session_id: "s" }),
      ),
    ).toBe("model not found");
  });

  it("falls back to the subtype when result is null", () => {
    expect(
      describeFailure(
        JSON.stringify({
          is_error: true,
          result: null,
          subtype: "error_max_turns",
          session_id: "s",
        }),
      ),
    ).toBe("error_max_turns");
  });

  it("returns undefined for stdout that isn't an envelope", () => {
    expect(describeFailure("")).toBeUndefined();
    expect(describeFailure("[1]")).toBeUndefined();
  });
});
