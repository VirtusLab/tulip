import type { RunOptions } from "../cli/args.js";
import { createLogger } from "../logging/logger.js";

/**
 * Runs the full PR-explanation pipeline: fetch the PR, analyze it with LLMs,
 * and render the result as an HTML page. Logs progress as it moves through phases.
 *
 * Stub — filled in by later epics (fetching, analysis, rendering).
 */
export async function run(options: RunOptions): Promise<void> {
  const logger = createLogger({ verbose: options.verbose });
  logger.debug(`options: ${JSON.stringify(options)}`);
  logger.info(`would process ${options.prUrl} (diff threshold: ${options.diffThreshold} lines)`);
}
