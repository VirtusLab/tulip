import type { PrCheckout } from "../checkout/checkout.js";
import { parseSnippetRefs } from "../explanations/markup.js";
import type { CategoryExplanation } from "../explanations/types.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { type BuildInfo, formatVersion, getBuildInfo } from "../version.js";
import {
  type AssembleDeps,
  type AssembleResult,
  assembleOutput,
  DEFAULT_ASSETS_DIR,
} from "./assemble.js";
import { loadFileDiffs } from "./file-diffs.js";
import { loadInlineAssets } from "./standalone.js";
import { type PageInput, renderPage } from "./template.js";

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
  /** Serve mode (docs/adr/0019): renders a per-category review box. Default false (static page).
   * The single-file copy is always static. */
  serve?: boolean;
  /** Adds the Share button to index.html (docs/adr/0029). */
  share?: boolean;
}

export interface RenderDeps extends AssembleDeps {
  /** Only file-content access is needed — see src/checkout/checkout.ts. */
  checkout: Pick<PrCheckout, "getFileAtBase" | "getFileAtHead">;
  logger?: Logger;
  /** Supplies the build info shown in the page footer (see src/version.ts). Defaults to the
   * real `getBuildInfo`; overridable so tests don't depend on a real dist/build-info.json. */
  getBuildInfo?: () => BuildInfo;
  loadInlineAssets?: typeof loadInlineAssets;
}

/**
 * The rendering epic's entry point (Epic 8 calls this after phases 1-3 produce
 * `explanations`): resolves every `{{snippet}}` marker's file against `deps.checkout`, renders
 * the full HTML page and its single-file copy, and assembles them into a fresh temp directory
 * (task 7.4).
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
  const assetsDir = deps.assetsDir ?? DEFAULT_ASSETS_DIR;
  const [inlineAssets, fileDiffs] = await Promise.all([
    (deps.loadInlineAssets ?? loadInlineAssets)(assetsDir),
    loadFileDiffs(referencedPaths, deps.checkout, input.renamedFrom),
  ]);

  const pageInput: PageInput = {
    prTitle: input.prTitle,
    prDescription: input.prDescription,
    prUrl: input.prUrl,
    explanations: input.explanations,
    fileDiffs,
    generatedBy: formatVersion((deps.getBuildInfo ?? getBuildInfo)()),
  };
  const standalonePage = renderPage({ ...pageInput, inlineAssets });

  return assembleOutput(
    {
      page: renderPage({ ...pageInput, serve: input.serve ?? false, share: input.share ?? false }),
      standalonePage,
    },
    { ...deps, assetsDir, logger },
  );
}
