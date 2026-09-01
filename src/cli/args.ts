import { parseArgs } from "node:util";
import { config } from "../config.js";
import { type PrRef, parsePrUrl } from "../github/pr-url.js";

/** Default `--diff-threshold`: max diff lines fed verbatim to the explaining LLM. */
const DEFAULT_DIFF_THRESHOLD = config.limits.defaultDiffThreshold;

/** Options collected from the command line, needed to run the pipeline. */
export interface RunOptions {
  /** GitHub PR URL, e.g. https://github.com/owner/repo/pull/123. */
  prUrl: string;
  /** The PR URL, parsed into owner/repo/number. */
  pr: PrRef;
  /** Max diff size (in lines) fed verbatim to the explaining LLM; larger changes are passed as file+line-range references. */
  diffThreshold: number;
  /** Show debug-level progress logging. */
  verbose: boolean;
  /** Auto-open the rendered page in the default browser when done. Defaults to true. */
  open: boolean;
}

/** Thrown for any invalid invocation; the message is shown to the user alongside usage info. */
export class CliUsageError extends Error {}

/** Thrown when `--help`/`-h` is given: not an error, just a request to print usage and exit 0. */
export class HelpRequestedError extends Error {}

/** Thrown when `--version`/`-v` is given: not an error, just a request to print the version and
 * exit 0. */
export class VersionRequestedError extends Error {}

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
    "  --verbose             Show debug-level progress logging",
    "  --no-open             Don't automatically open the rendered page in your browser",
    "  -h, --help            Show this help and exit",
    "  -v, --version         Show version information and exit",
  ].join("\n");
}

/**
 * Parses and validates CLI arguments (excluding `node`/script path, i.e. `process.argv.slice(2)`).
 * Throws {@link CliUsageError} with a user-facing message on any invalid input.
 */
export function parseCliArgs(argv: string[]): RunOptions {
  let values: {
    "diff-threshold"?: string;
    verbose?: boolean;
    "no-open"?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        "diff-threshold": { type: "string" },
        verbose: { type: "boolean" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }

  if (values.help) {
    throw new HelpRequestedError();
  }
  if (values.version) {
    throw new VersionRequestedError();
  }

  if (positionals.length === 0) {
    throw new CliUsageError("Missing required argument: <PR URL>");
  }
  if (positionals.length > 1) {
    throw new CliUsageError(`Unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
  }

  const [prUrl] = positionals;
  const pr = prUrl === undefined ? undefined : parsePrUrl(prUrl);
  if (prUrl === undefined || pr === undefined) {
    throw new CliUsageError(
      `Invalid PR URL: "${prUrl}". Expected format: https://github.com/<owner>/<repo>/pull/<number>`,
    );
  }

  const diffThreshold = parseDiffThreshold(values["diff-threshold"]);

  return { prUrl, pr, diffThreshold, verbose: values.verbose ?? false, open: !values["no-open"] };
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
