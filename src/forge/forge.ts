import { githubForge } from "../github/adapter.js";
import { gitlabForge } from "../gitlab/adapter.js";
import type { Forge, ForgeAdapter, PrCommenter, PrMetadata, PrRef } from "./types.js";

const ADAPTERS: Record<Forge, ForgeAdapter> = { github: githubForge, gitlab: gitlabForge };

/** The adapter for the forge that serves `pr`. */
export function forgeFor(pr: PrRef): ForgeAdapter {
  return ADAPTERS[pr.forge];
}

/** Fetches a PR's metadata from whichever forge serves it — the pipeline's injectable seam. */
export function fetchPrMetadata(pr: PrRef): Promise<PrMetadata> {
  return forgeFor(pr).fetchPrMetadata(pr);
}

/** The commenter serve mode posts to `pr` with; throws if `pr`'s forge doesn't support it. */
export function commenterFor(pr: PrRef): PrCommenter {
  const commenter = forgeFor(pr).commenter;
  if (!commenter) {
    throw new Error(`--serve is not supported for ${pr.forge} (${pr.host})`);
  }
  return commenter;
}
