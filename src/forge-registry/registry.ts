import type { Forge, ForgeAdapter, PrRef } from "../forge/types.js";
import { githubAdapter } from "../github/adapter.js";
import { gitlabAdapter } from "../gitlab/adapter.js";

const ADAPTERS: Record<Forge, ForgeAdapter> = { github: githubAdapter, gitlab: gitlabAdapter };

/** The adapter for the forge that serves `pr`. */
export function forgeFor(pr: PrRef): ForgeAdapter {
  return ADAPTERS[pr.forge];
}
