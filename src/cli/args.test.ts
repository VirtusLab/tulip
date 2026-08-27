import { describe, expect, it } from "vitest";
import { CliUsageError, DEFAULT_DIFF_THRESHOLD, parseCliArgs } from "./args.js";

const VALID_URL = "https://github.com/owner/repo/pull/123";

describe("parseCliArgs", () => {
  it("parses a valid PR URL with defaults for diff threshold and verbosity", () => {
    expect(parseCliArgs([VALID_URL])).toEqual({
      prUrl: VALID_URL,
      diffThreshold: DEFAULT_DIFF_THRESHOLD,
      verbose: false,
    });
  });

  it("accepts --diff-threshold and parses it as an integer", () => {
    expect(parseCliArgs([VALID_URL, "--diff-threshold", "800"])).toEqual({
      prUrl: VALID_URL,
      diffThreshold: 800,
      verbose: false,
    });
  });

  it("accepts --verbose", () => {
    expect(parseCliArgs([VALID_URL, "--verbose"]).verbose).toBe(true);
  });

  it("accepts a trailing slash in the PR URL", () => {
    expect(parseCliArgs([`${VALID_URL}/`]).prUrl).toBe(`${VALID_URL}/`);
  });

  it("throws when no arguments are given", () => {
    expect(() => parseCliArgs([])).toThrow(CliUsageError);
  });

  it("throws with a helpful message when too many positionals are given", () => {
    expect(() => parseCliArgs([VALID_URL, "extra"])).toThrow(/Unexpected extra arguments/);
  });

  it.each([
    "https://gitlab.com/owner/repo/pull/123",
    "https://github.com/owner/repo/issues/123",
    "https://github.com/owner/repo",
    "not-a-url",
  ])("throws for an invalid PR URL: %s", (url) => {
    expect(() => parseCliArgs([url])).toThrow(/Invalid PR URL/);
  });

  it.each(["0", "-5", "abc", "1.5"])(
    "throws for an invalid --diff-threshold value: %s",
    (value) => {
      expect(() => parseCliArgs([VALID_URL, `--diff-threshold=${value}`])).toThrow(
        /Invalid --diff-threshold/,
      );
    },
  );

  it("throws for an unknown flag", () => {
    expect(() => parseCliArgs([VALID_URL, "--unknown-flag"])).toThrow(CliUsageError);
  });
});
