import { parseArgs } from "node:util";
import type { RunOptions } from "../pipeline/run.js";

/** Default `--diff-threshold`: max diff lines fed verbatim to the explaining LLM. */
export const DEFAULT_DIFF_THRESHOLD = 400;

const GITHUB_PR_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/;

/** Thrown for any invalid invocation; the message is shown to the user alongside usage info. */
export class CliUsageError extends Error {}

/** Multi-line usage text shown on `--help` or invalid invocation. */
export function usage(): string {
  return [
    "Usage: tulip <PR URL> [options]",
    "",
    "Explains a GitHub PR to reviewers using LLMs.",
    "",
    "Arguments:",
    "  <PR URL>              GitHub PR URL, e.g. https://github.com/owner/repo/pull/123",
    "",
    "Options:",
    `  --diff-threshold <n>  Max diff size (lines) fed verbatim to the LLM; larger changes are`,
    `                        passed as file+line-range references (default: ${DEFAULT_DIFF_THRESHOLD})`,
    "  --verbose              Show debug-level progress logging",
  ].join("\n");
}

/**
 * Parses and validates CLI arguments (excluding `node`/script path, i.e. `process.argv.slice(2)`).
 * Throws {@link CliUsageError} with a user-facing message on any invalid input.
 */
export function parseCliArgs(argv: string[]): RunOptions {
  let values: { "diff-threshold"?: string; verbose?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        "diff-threshold": { type: "string" },
        verbose: { type: "boolean" },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }

  if (positionals.length === 0) {
    throw new CliUsageError("Missing required argument: <PR URL>");
  }
  if (positionals.length > 1) {
    throw new CliUsageError(`Unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
  }

  const [prUrl] = positionals;
  if (prUrl === undefined || !GITHUB_PR_URL_PATTERN.test(prUrl)) {
    throw new CliUsageError(
      `Invalid PR URL: "${prUrl}". Expected format: https://github.com/<owner>/<repo>/pull/<number>`,
    );
  }

  const diffThreshold = parseDiffThreshold(values["diff-threshold"]);

  return { prUrl, diffThreshold, verbose: values.verbose ?? false };
}

function parseDiffThreshold(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_DIFF_THRESHOLD;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`Invalid --diff-threshold: "${raw}". Expected a positive integer.`);
  }
  return value;
}
