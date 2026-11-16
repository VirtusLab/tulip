import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type Logger } from "../logging/logger.js";

/** Writes one file's content. Mockable in tests. */
export type FileWriter = (path: string, content: string) => Promise<void>;

export interface AssembleDeps {
  logger?: Logger;
  /** Defaults to a fresh directory under the OS temp dir. */
  mkdtemp?: () => Promise<string>;
  writeFile?: FileWriter;
}

export interface AssembleResult {
  /** Absolute path to the output directory. */
  dir: string;
  /** Absolute path to the page within it. */
  indexPath: string;
}

/**
 * Writes the rendered `page` as `index.html` into a fresh OS temp directory, and logs how to open
 * it. The page embeds all its assets (docs/adr/0030), so it is the only file.
 */
export async function assembleOutput(
  page: string,
  deps: AssembleDeps = {},
): Promise<AssembleResult> {
  const logger = deps.logger ?? createLogger();
  const makeTempDir = deps.mkdtemp ?? defaultMkdtemp;
  const write = deps.writeFile ?? defaultWriteFile;

  const dir = await makeTempDir();
  const indexPath = join(dir, "index.html");

  await write(indexPath, page);

  logger.info(`explanation page ready — open file://${indexPath} in your browser`);
  return { dir, indexPath };
}

async function defaultMkdtemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tulip-render-"));
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
}
