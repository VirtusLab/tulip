import { spawn } from "node:child_process";
import { AgentBinaryMissingError } from "../agent/errors.js";
import type { Agent, AgentId } from "../agent/types.js";
import { createUsageLedger, formatUsageSummary } from "../agent/usage.js";
import { prepareWorkspace } from "../agent/workspace.js";
import { createAgentFor } from "../agent-registry/registry.js";
import { generateCategories } from "../categories/generate.js";
import { reviewAndAmendCategories } from "../categories/review.js";
import type { Category } from "../categories/types.js";
import { createCheckout, type PrCheckout } from "../checkout/checkout.js";
import { materializeChangeArtifacts } from "../checkout/materialize.js";
import { type CategoryChangeSet, groupChangesByCategory } from "../classification/group.js";
import { type ClassifyChangesResult, classifyChanges } from "../classification/orchestrate.js";
import { prepareClassifiableChanges } from "../classification/prepare.js";
import type { ParsedDiff } from "../diff/change.js";
import { parseDiff } from "../diff/parse-diff.js";
import { explainCategories } from "../explanations/orchestrate.js";
import type { PrMetadata, PrRef } from "../forge/types.js";
import { forgeFor } from "../forge-registry/registry.js";
import { startTimer } from "../logging/duration.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { renderExplanations } from "../rendering/render.js";
import { serveForReview } from "../serve/server.js";
import { splitLargeChanges } from "../splitting/orchestrate.js";
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
  /** Run a local review server that posts per-category PR comments (docs/adr/0019), instead of
   * rendering a static page and exiting. Fails when the PR's forge has no `commenter`. */
  serve: boolean;
  /** Which agent CLI runs every LLM pass (docs/adr/0027); see src/cli/agent-choice.ts. */
  agent: AgentId;
}

/** Opens `path` (a local file) in the user's default browser. Rejects if the opener binary is
 * missing or the spawn otherwise fails; never throws synchronously. */
export type BrowserOpener = (path: string) => Promise<void>;

/** Test/advanced-use seams: every phase function, injectable for orchestration tests. All
 * default to the real epic 2-7 implementations. */
export interface PipelineDeps {
  forgeFor?: typeof forgeFor;
  createCheckout?: typeof createCheckout;
  materializeChangeArtifacts?: typeof materializeChangeArtifacts;
  prepareWorkspace?: typeof prepareWorkspace;
  generateCategories?: typeof generateCategories;
  reviewAndAmendCategories?: typeof reviewAndAmendCategories;
  splitLargeChanges?: typeof splitLargeChanges;
  classifyChanges?: typeof classifyChanges;
  explainCategories?: typeof explainCategories;
  renderExplanations?: typeof renderExplanations;
  serveForReview?: typeof serveForReview;
  /** Defaults to spawning the OS's own "open a file" command. Injected in tests so the suite
   * never actually spawns a browser. */
  openInBrowser?: BrowserOpener;
  /** Overrides the agent built from `options.agent`. */
  agent?: Agent;
  logger?: Logger;
}

/** Tags an underlying error with which pipeline phase it happened in, for a clear top-level
 * failure message (task 8.2). The original error is kept as `cause` so callers can still branch
 * on its type (e.g. AgentBinaryMissingError). */
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
  const doCreateCheckout = deps.createCheckout ?? createCheckout;
  const doMaterializeChangeArtifacts =
    deps.materializeChangeArtifacts ?? materializeChangeArtifacts;
  const doPrepareWorkspace = deps.prepareWorkspace ?? prepareWorkspace;
  const doGenerateCategories = deps.generateCategories ?? generateCategories;
  const doReviewAndAmendCategories = deps.reviewAndAmendCategories ?? reviewAndAmendCategories;
  const doSplitLargeChanges = deps.splitLargeChanges ?? splitLargeChanges;
  const doClassifyChanges = deps.classifyChanges ?? classifyChanges;
  const doExplainCategories = deps.explainCategories ?? explainCategories;
  const doRenderExplanations = deps.renderExplanations ?? renderExplanations;
  const doServeForReview = deps.serveForReview ?? serveForReview;
  const doOpenInBrowser = deps.openInBrowser ?? defaultOpenInBrowser;

  const adapter = (deps.forgeFor ?? forgeFor)(options.pr);
  const prUrl = adapter.webUrl(options.pr);

  // One per run, so every phase's sessions (and their resumes) go through the same agent.
  const agent = deps.agent ?? createAgentFor(options.agent);

  logger.info(formatVersion());
  logger.info(`Processing PR ${prUrl} with ${agent.backend.id}`);
  logger.debug(`options: ${JSON.stringify(options)}`);

  // Shared by every phase (threaded via each phase's RunnerDeps), summarized at the end.
  const usage = createUsageLedger();

  let checkout: PrCheckout | undefined;
  try {
    // Serve mode has no posting fallback, so an unsupported forge or broken auth makes it
    // pointless: fail fast here, before any fetch/checkout/LLM work. Not wrapped in runPhase —
    // these messages are already actionable and must reach the user verbatim via describeFailure.
    const commenter = options.serve ? adapter.commenter : undefined;
    if (options.serve && !commenter) {
      throw new Error(`--serve isn't supported for ${options.pr.forge} URLs`);
    }
    await commenter?.checkAuth(options.pr.host);

    logger.info(`fetching ${adapter.label(options.pr)}...`);
    const metadata = await runPhase("fetching PR", () => adapter.fetchPrMetadata(options.pr));

    const diff = parseDiff(metadata.diff);
    warnOnFileListMismatch(metadata, diff, logger);

    if (prepareClassifiableChanges(diff).length === 0) {
      // Binary-only/mode-only PR: nothing for phases 1-3 to work with. Exit cleanly rather than
      // sending an empty change list into classification, which would blame the agent for an empty
      // reply to a task that was never meaningful.
      logger.info("nothing to review: this PR has no classifiable changes");
      return;
    }

    logger.debug("creating checkout...");
    checkout = await runPhase("creating checkout", () =>
      doCreateCheckout(
        options.pr,
        { base: metadata.base, head: metadata.head },
        adapter.checkoutAuth,
      ),
    );
    // Every agent session below runs with the checkout dir as its cwd (RULING), so it reads
    // the actual repo files instead of inheriting this process's cwd. Captured into its own
    // const (rather than reading `checkout.dir` in the closures below) because TypeScript can't
    // narrow a mutated outer `let` across a closure boundary.
    const checkoutDir = checkout.dir;

    logger.debug("materializing change artifacts...");
    await runPhase("materializing change artifacts", () =>
      doMaterializeChangeArtifacts(checkout as PrCheckout, diff, metadata.diff, { logger }),
    );
    // Before any agent call: strips repo-controlled config the agent CLI would load from its cwd
    // (see `AgentBackend.repoConfigDirs`).
    await runPhase("preparing agent workspace", () =>
      doPrepareWorkspace(checkoutDir, agent.backend),
    );

    const changedFiles = diff.files.map((file) => ({ path: file.path, status: file.status }));

    logger.info("phase 1: generating categories...");
    const generateElapsed = startTimer();
    const phase1 = await runPhase("phase 1 (generating categories)", () =>
      doGenerateCategories(
        { title: metadata.title, description: metadata.body, files: changedFiles },
        { cwd: checkoutDir, usage, logger, agent },
      ),
    );
    logger.info(
      `generated ${phase1.categories.length} categories in ${generateElapsed()}: ` +
        categoryNamesOf(phase1.categories),
    );

    logger.info("phase 1: reviewing categories...");
    const reviewElapsed = startTimer();
    const categoryReview = await runPhase("phase 1 (reviewing categories)", () =>
      doReviewAndAmendCategories(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          files: changedFiles,
          categories: phase1.categories,
          generateSessionId: phase1.sessionId,
        },
        { cwd: checkoutDir, usage, logger, agent },
      ),
    );
    logger.info(
      `categories after review (${reviewElapsed()}): ${categoryNamesOf(categoryReview.categories)}`,
    );

    // Splits over-threshold changes into per-concern sub-changes (docs/adr/0016), so
    // classification can route each piece to its own category. Coverage is guaranteed in code, so
    // this only ever refines the diff — everything downstream sees more, smaller changes. Only
    // classification is given the split diff; grouping/explain/render inherit the sub-changes via
    // the classification result, and the file-level uses of `diff` below stay on the original.
    logger.info("phase 2: splitting large changes...");
    const splitDiff = await runPhase("splitting large changes", () =>
      doSplitLargeChanges(
        { diff, categories: categoryReview.categories },
        { logger, cwd: checkoutDir, usage, agent },
      ),
    );

    logger.info("phase 2: classifying changes...");
    const classifyElapsed = startTimer();
    const classification = await runPhase("phase 2 (classifying changes)", () =>
      doClassifyChanges(
        {
          diff: splitDiff,
          categories: categoryReview.categories,
          phase1SessionId: categoryReview.sessionId,
        },
        { cwd: checkoutDir, usage, logger, agent },
      ),
    );

    const { sets: categorySets, owners: changeOwners } = groupChangesByCategory(classification);
    logger.info(describeClassification(classification, categorySets, classifyElapsed()));

    logger.info(`phase 3: generating explanations for ${categorySets.length} categories...`);
    const explainElapsed = startTimer();
    const explanations = await runPhase("phase 3 (generating explanations)", () =>
      doExplainCategories(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          diffThreshold: options.diffThreshold,
          baseSha: metadata.base.sha,
          headSha: metadata.head.sha,
          categorySets,
          changeOwners,
        },
        { logger, cwd: checkoutDir, usage, agent },
      ),
    );
    logger.info(
      `generated explanations for ${explanations.length} categories in ${explainElapsed()}`,
    );

    logger.info("preparing output page...");
    const renamedFrom = buildRenamedFromMap(diff);
    // Safe: this phase only runs once "creating checkout" (above) has already succeeded, so
    // `checkout` is always assigned by this point — TypeScript just can't see that across the
    // try/finally.
    const { dir, indexPath } = await runPhase("rendering", () =>
      doRenderExplanations(
        {
          prTitle: metadata.title,
          prDescription: metadata.body,
          prUrl,
          explanations,
          renamedFrom,
          serve: options.serve,
        },
        { checkout: checkout as PrCheckout, logger },
      ),
    );
    logger.debug(`rendered output at ${indexPath}`);

    const categoryNames = explanations.map((explanation) => explanation.category.name);

    if (commenter) {
      // Serves the rendered dir over http://, opens it (honoring --no-open), and blocks until
      // Ctrl+C; on resolve the finally below cleans up the checkout, as in the static path.
      await doServeForReview({
        dir,
        prUrl,
        categoryNames,
        postComment: commenter.postComment,
        open: options.open,
        logger,
        openInBrowser: doOpenInBrowser,
      });
    } else if (options.open) {
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
    // Printed whenever any LLM work ran — on success, and after a mid-run failure that still
    // burned tokens; empty for an untouched ledger.
    const usageSummary = formatUsageSummary(usage);
    const unreported = usage.unreportedCalls();
    if (usageSummary) {
      logger.info(usageSummary);
    }
    if (unreported > 0) {
      logger.info(`${unreported} ${agent.backend.id} call(s) didn't report token usage`);
    }
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

/** Builds the final, user-facing failure line: no stack trace, and — for the common "agent CLI
 * isn't installed/logged in" case — just its own already-actionable message. */
function describeFailure(error: unknown): string {
  const cause = error instanceof PhaseError ? error.cause : error;
  if (cause instanceof AgentBinaryMissingError) {
    return cause.message;
  }
  return causeMessage(error);
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function categoryNamesOf(categories: Category[]): string {
  return categories.map((category) => category.name).join(", ");
}

/** Phase 2 summary line. The total is `changesById.size` — every classifiable change, ignored ones
 * included — so the per-category counts (a change can be in several) plus the ignored count are
 * read against the number of changes that actually went in. */
function describeClassification(
  classification: ClassifyChangesResult,
  categorySets: CategoryChangeSet[],
  elapsed: string,
): string {
  const perCategory = categorySets
    .map((set) => `${set.category.name} (${set.production.length + set.test.length})`)
    .join(", ");
  const ignored = classification.ignoredChangeIds.size;
  return (
    `classified ${classification.changesById.size} changes in ${elapsed}: ${perCategory}` +
    (ignored > 0 ? `; ${ignored} ignored` : "")
  );
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

/**
 * Sanity check carried from Epic 2's review: cross-checks `PrMetadata.files` (what the forge
 * says changed) against the parsed diff's file paths (what we actually analyze). A mismatch would
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
