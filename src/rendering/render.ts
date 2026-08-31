import type { FileStatus } from "../diff/change.js";
import { parseSnippetRefs } from "../explanations/markup.js";
import type { CategoryExplanation } from "../explanations/types.js";
import type { PrCheckout } from "../github/checkout.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { type AssembleDeps, type AssembleResult, assembleOutput } from "./assemble.js";
import { loadFileDiffs } from "./file-diffs.js";
import { renderPage } from "./template.js";

/** What's needed to render the final page: PR context plus the reviewed, coverage-verified
 * explanations in presentation order (see src/explanations/orchestrate.ts, epic 6). */
export interface RenderInput {
  prTitle: string;
  prDescription: string;
  prUrl: string;
  explanations: CategoryExplanation[];
  /** Maps a renamed file's head-side path to its base-side path (see src/diff/change.ts's
   * `FileDiff.previousPath`) — lets snippet base content be fetched from the right revision path
   * for a renamed-with-changes file. Defaults to no renames. */
  renamedFrom?: Map<string, string>;
  /** Maps a referenced path to its `FileDiff.status` (see src/diff/change.ts) — lets an
   * added/removed file render as a single pane instead of a two-pane split with one side always
   * blank (see ./snippets.ts). A path missing from it defaults to "modified" (two-pane). */
  fileStatuses?: Map<string, FileStatus>;
}

export interface RenderDeps extends AssembleDeps {
  /** Only file-content access is needed — see src/github/checkout.ts. */
  checkout: Pick<PrCheckout, "getFileAtBase" | "getFileAtHead">;
  logger?: Logger;
}

/**
 * The rendering epic's entry point (Epic 8 calls this after phases 1-3 produce
 * `explanations`): resolves every `{{snippet}}` marker's file against `deps.checkout`, renders
 * the full HTML page, and assembles it into a fresh temp directory (task 7.4).
 */
export async function renderExplanations(
  input: RenderInput,
  deps: RenderDeps,
): Promise<AssembleResult> {
  const logger = deps.logger ?? createLogger();
  logger.info("rendering explanation page...");

  const referencedPaths = input.explanations.flatMap((explanation) =>
    parseSnippetRefs(explanation.markdown).map((match) => match.ref.path),
  );
  const fileDiffs = await loadFileDiffs(
    referencedPaths,
    deps.checkout,
    input.renamedFrom,
    input.fileStatuses,
  );

  const page = renderPage({
    prTitle: input.prTitle,
    prDescription: input.prDescription,
    prUrl: input.prUrl,
    explanations: input.explanations,
    fileDiffs,
  });

  return assembleOutput(page, { ...deps, logger });
}
