/** Options collected from the command line, needed to run the pipeline. */
export interface RunOptions {
  /** GitHub PR URL, e.g. https://github.com/owner/repo/pull/123. */
  prUrl: string;
  /** Max diff size (in lines) fed verbatim to the explaining LLM; larger changes are passed as file+line-range references. */
  diffThreshold: number;
}

/**
 * Runs the full PR-explanation pipeline: fetch the PR, analyze it with LLMs,
 * and render the result as an HTML page.
 *
 * Stub — filled in by later epics (fetching, analysis, rendering).
 */
export async function run(options: RunOptions): Promise<void> {
  console.log(
    `tulip: would process ${options.prUrl} (diff threshold: ${options.diffThreshold} lines)`,
  );
}
