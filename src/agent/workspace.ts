import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackend } from "./types.js";

/** Removes `backend`'s {@link AgentBackend.repoConfigDirs} from the checkout at `dir`; run once
 * before any call. A symlinked dir is unlinked, never followed, so nothing outside the checkout
 * is touched. */
export async function prepareWorkspace(dir: string, backend: AgentBackend): Promise<void> {
  await Promise.all(
    backend.repoConfigDirs.map((name) => rm(join(dir, name), { recursive: true, force: true })),
  );
}
