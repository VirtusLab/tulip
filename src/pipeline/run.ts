import type { PrRef } from "../github/pr-url.js";
import { createLogger } from "../logging/logger.js";

/** Input the pipeline needs to process a PR. Constructed by callers (e.g. the CLI). */
export interface PipelineOptions {
  pr: PrRef;
  /** Max diff size (in lines) fed verbatim to the explaining LLM; larger changes are passed as file+line-range references. */
  diffThreshold: number;
  /** Show debug-level progress logging. */
  verbose: boolean;
}

/**
 * Runs the full PR-explanation pipeline: fetch the PR, analyze it with LLMs,
 * and render the result as an HTML page. Logs progress as it moves through phases.
 *
 * Stub — filled in by later epics (fetching, analysis, rendering).
 */
export async function run(options: PipelineOptions): Promise<void> {
  const logger = createLogger({ verbose: options.verbose });
  logger.debug(`options: ${JSON.stringify(options)}`);
  const { owner, repo, number } = options.pr;
  logger.info(
    `would process ${owner}/${repo}#${number} (diff threshold: ${options.diffThreshold} lines)`,
  );
}
