import { spawn } from "node:child_process";
import { generateCategories } from "../categories/generate.js";
import { reviewAndAmendCategories } from "../categories/review.js";
import { groupChangesByCategory } from "../classification/group.js";
import { classifyChanges } from "../classification/orchestrate.js";
import { prepareClassifiableChanges } from "../classification/prepare.js";
import { ClaudeBinaryMissingError } from "../claude/errors.js";
import type { FileStatus, ParsedDiff } from "../diff/change.js";
import { parseDiff } from "../diff/parse-diff.js";
import { explainCategories } from "../explanations/orchestrate.js";
import { createCheckout, type PrCheckout } from "../github/checkout.js";
import { materializeChangeArtifacts } from "../github/materialize.js";
import { fetchPrMetadata, type PrMetadata } from "../github/pr-fetcher.js";
import type { PrRef } from "../github/pr-url.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { renderExplanations } from "../rendering/render.js";
import { formatVersion } from "../version.js";

/** Input the pipeline needs to process a PR. Constructed by callers (e.g. the CLI). */
export interface PipelineOptions {
  pr: PrRef;
  /** Max diff size (in lines) fed verbatim to the explaining LLM; larger changes are passed as file+line-range references. */
  diffThreshold: number;
  /** Show debug-level progress logging. */
  verbose: boolean;
  /** Auto-open the rendered page in the default browser when done. */
  open: boolean;
}

/** Opens `path` (a local file) in the user's default browser. Rejects if the opener binary is
 * missing or the spawn otherwise fails; never throws synchronously. */
export type BrowserOpener = (path: string) => Promise<void>;

/** Test/advanced-use seams: every phase function, injectable for orchestration tests. All
 * default to the real epic 2-7 implementations. */
export interface PipelineDeps {
  fetchPrMetadata?: typeof fetchPrMetadata;
  createCheckout?: typeof createCheckout;
  materializeChangeArtifacts?: typeof materializeChangeArtifacts;
  generateCategories?: typeof generateCategories;
  reviewAndAmendCategories?: typeof reviewAndAmendCategories;
  classifyChanges?: typeof classifyChanges;
  explainCategories?: typeof explainCategories;
  renderExplanations?: typeof renderExplanations;
  /** Defaults to spawning the OS's own "open a file" command. Injected in tests so the suite
   * never actually spawns a browser. */
  openInBrowser?: BrowserOpener;
  logger?: Logger;
}

/** Tags an underlying error with which pipeline phase it happened in, for a clear top-level
 * failure message (task 8.2). The original error is kept as `cause` so callers can still branch
 * on its type (e.g. ClaudeBinaryMissingError). */
class PhaseError extends Error {
  constructor(phase: string, cause: unknown) {
    super(`${phase} failed: ${causeMessage(cause)}`);
    this.name = "PhaseError";
    this.cause = cause;
  }
}

/**
 * Runs the full PR-explanation pipeline: fetch the PR, analyze it with LLMs across phases 1-3,
 * and render the result as an HTML page. Logs progress throughout (phases, generated categories,
 * per-category explanation progress). On any failure, logs a clear message (no stack trace),
 * sets a non-zero exit code, and still cleans up the checkout; the rendered output directory is
 * only ever created on success and is always kept.
 */
export async function run(options: PipelineOptions, deps: PipelineDeps = {}): Promise<void> {
  const logger = deps.logger ?? createLogger({ verbose: options.verbose });
  const doFetchPrMetadata = deps.fetchPrMetadata ?? fetchPrMetadata;
  const doCreateCheckout = deps.createCheckout ?? createCheckout;
  const doMaterializeChangeArtifacts =
    deps.materializeChangeArtifacts ?? materializeChangeArtifacts;
  const doGenerateCategories = deps.generateCategories ?? generateCategories;
  const doReviewAndAmendCategories = deps.reviewAndAmendCategories ?? reviewAndAmendCategories;
  const doClassifyChanges = deps.classifyChanges ?? classifyChanges;
  const doExplainCategories = deps.explainCategories ?? explainCategories;
  const doRenderExplanations = deps.renderExplanations ?? renderExplanations;
  const doOpenInBrowser = deps.openInBrowser ?? defaultOpenInBrowser;

  const { owner, repo, number } = options.pr;
  const prUrl = `https://github.com/${owner}/${repo}/pull/${number}`;

  logger.info(formatVersion());
  logger.info(`Processing PR ${prUrl}`);
  logger.debug(`options: ${JSON.stringify(options)}`);

  let checkout: PrCheckout | undefined;
  try {
    logger.info(`fetching ${owner}/${repo}#${number}...`);
    const metadata = await runPhase("fetching PR", () => doFetchPrMetadata(options.pr));

    const diff = parseDiff(metadata.diff);
    warnOnFileListMismatch(metadata, diff, logger);

    if (prepareClassifiableChanges(diff).length === 0) {
      // Binary-only/mode-only PR: nothing for phases 1-3 to work with. Exit cleanly rather than
      // sending an empty change list into classification, which would blame claude for an empty
      // reply to a task that was never meaningful.
      logger.info("nothing to review: this PR has no classifiable changes");
      return;
    }

    logger.debug("creating checkout...");
    checkout = await runPhase("creating checkout", () =>
      doCreateCheckout(options.pr, { base: metadata.base, head: metadata.head }),
    );
    // Every claude session below runs with the checkout dir as its cwd (RULING), so it reads
    // the actual repo files instead of inheriting this process's cwd. Captured into its own
    // const (rather than reading `checkout.dir` in the closures below) because TypeScript can't
    // narrow a mutated outer `let` across a closure boundary.
    const checkoutDir = checkout.dir;

    logger.debug("materializing change artifacts...");
    await runPhase("materializing change artifacts", () =>
      doMaterializeChangeArtifacts(checkout as PrCheckout, diff, metadata.diff, { logger }),
    );

    const changedFiles = diff.files.map((file) => ({ path: file.path, status: file.status }));

    logger.info("phase 1: generating categories...");
    const phase1 = await runPhase("phase 1 (generating categories)", () =>
      doGenerateCategories(
        { title: metadata.title, description: metadata.body, files: changedFiles },
        { cwd: checkoutDir },
      ),
    );
    logger.info(
      `generated ${phase1.categories.length} categories: ` +
        phase1.categories.map((category) => category.name).join(", "),
    );

    logger.info("phase 1: reviewing categories...");
    const categoryReview = await runPhase("phase 1 (reviewing categories)", () =>
      doReviewAndAmendCategories(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          files: changedFiles,
          categories: phase1.categories,
          generateSessionId: phase1.sessionId,
        },
        { cwd: checkoutDir },
      ),
    );
    logger.debug(
      `category review done: ${categoryReview.categories.length} categories: ` +
        categoryReview.categories.map((category) => category.name).join(", "),
    );

    logger.info("phase 2: classifying changes...");
    const classification = await runPhase("phase 2 (classifying changes)", () =>
      doClassifyChanges(
        {
          diff,
          categories: categoryReview.categories,
          phase1SessionId: categoryReview.sessionId,
        },
        { cwd: checkoutDir },
      ),
    );
    logger.debug(
      `classification done: ${classification.assignments.size} change(s) categorized, ` +
        `${classification.ignoredChangeIds.size} ignored`,
    );

    const { sets: categorySets } = groupChangesByCategory(classification);

    logger.info("phase 3: generating explanations...");
    const explanations = await runPhase("phase 3 (generating explanations)", () =>
      doExplainCategories(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          diffThreshold: options.diffThreshold,
          baseSha: metadata.base.sha,
          headSha: metadata.head.sha,
          categorySets,
        },
        { logger, cwd: checkoutDir },
      ),
    );
    logger.info(`generated explanations for ${explanations.length} categories`);

    logger.info("preparing output page...");
    const renamedFrom = buildRenamedFromMap(diff);
    const fileStatuses = buildFileStatusMap(diff);
    // Safe: this phase only runs once "creating checkout" (above) has already succeeded, so
    // `checkout` is always assigned by this point — TypeScript just can't see that across the
    // try/finally.
    const { indexPath } = await runPhase("rendering", () =>
      doRenderExplanations(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          prUrl,
          explanations,
          renamedFrom,
          fileStatuses,
        },
        { checkout: checkout as PrCheckout, logger },
      ),
    );
    logger.debug(`rendered output at ${indexPath}`);

    if (options.open) {
      try {
        await doOpenInBrowser(indexPath);
      } catch (error) {
        // Never fail the run over this — the file:// path logged by assembleOutput (above,
        // unconditional) is always there as a fallback.
        logger.debug(`could not auto-open the page: ${causeMessage(error)}`);
      }
    }
  } catch (error) {
    logger.info(describeFailure(error));
    process.exitCode = 1;
  } finally {
    if (checkout) {
      logger.debug("cleaning up checkout...");
      try {
        await checkout.cleanup();
      } catch (error) {
        // Never let a cleanup failure escape the finally: it would surface as an unhandled
        // rejection past this function's own no-stack-trace error reporting above.
        logger.info(`warning: failed to clean up checkout: ${causeMessage(error)}`);
      }
    }
  }
}

async function runPhase<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new PhaseError(phase, error);
  }
}

/** Opens `path` via the OS's own "open a file with its default app" command — `open` (macOS),
 * `xdg-open` (Linux), or `cmd /c start ""` (Windows; the empty-string argument is `start`'s own
 * window-title placeholder, required so a path isn't mistaken for one). Always spawned with the
 * path as a separate argv element, never interpolated into a shell string — no injection surface
 * (this is also always our own temp file), and no shell is invoked at all. */
const defaultOpenInBrowser: BrowserOpener = (path) =>
  new Promise((resolve, reject) => {
    const { command, args } = openCommandFor(process.platform, path);
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

function openCommandFor(
  platform: NodeJS.Platform,
  path: string,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [path] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", path] };
  }
  return { command: "xdg-open", args: [path] };
}

/** Builds the final, user-facing failure line: no stack trace, and — for the common "claude
 * isn't installed/logged in" case — just its own already-actionable message. */
function describeFailure(error: unknown): string {
  const cause = error instanceof PhaseError ? error.cause : error;
  if (cause instanceof ClaudeBinaryMissingError) {
    return cause.message;
  }
  return causeMessage(error);
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Maps each renamed file's head-side path to its base-side path, for rendering's base-content
 * lookups (see src/rendering/file-diffs.ts's `renamedFrom`). */
function buildRenamedFromMap(diff: ParsedDiff): Map<string, string> {
  return new Map(
    diff.files.flatMap((file) =>
      file.previousPath ? [[file.path, file.previousPath] as const] : [],
    ),
  );
}

/** Maps each file's path to its `FileDiff.status`, so rendering can pick a single- vs two-pane
 * snippet layout (see src/rendering/file-diffs.ts's `fileStatuses`). */
function buildFileStatusMap(diff: ParsedDiff): Map<string, FileStatus> {
  return new Map(diff.files.map((file) => [file.path, file.status]));
}

/**
 * Sanity check carried from Epic 2's review: cross-checks `PrMetadata.files` (what GitHub says
 * changed) against the parsed diff's file paths (what we actually analyze). A mismatch would
 * mean some files silently aren't reviewed (or a parsing bug) — worth a warning, but not fatal.
 */
function warnOnFileListMismatch(metadata: PrMetadata, diff: ParsedDiff, logger: Logger): void {
  const diffPaths = new Set(diff.files.map((file) => file.path));
  const metadataPaths = new Set(metadata.files);

  const missingFromDiff = metadata.files.filter((path) => !diffPaths.has(path));
  const missingFromMetadata = [...diffPaths].filter((path) => !metadataPaths.has(path));

  if (missingFromDiff.length > 0 || missingFromMetadata.length > 0) {
    logger.info(
      "warning: PR file list and parsed diff disagree" +
        (missingFromDiff.length > 0
          ? ` — in file list but not diff: ${missingFromDiff.join(", ")}`
          : "") +
        (missingFromMetadata.length > 0
          ? ` — in diff but not file list: ${missingFromMetadata.join(", ")}`
          : ""),
    );
  }
}
