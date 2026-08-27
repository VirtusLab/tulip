import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, type Logger } from "../logging/logger.js";

/** Writes one file's content. Mockable in tests. */
export type FileWriter = (path: string, content: string) => Promise<void>;

/** Recursively copies a directory's contents into `dest`, creating it if needed. Mockable in
 * tests. */
export type DirCopier = (src: string, dest: string) => Promise<void>;

export interface AssembleDeps {
  logger?: Logger;
  /** Defaults to a fresh directory under the OS temp dir. */
  mkdtemp?: () => Promise<string>;
  writeFile?: FileWriter;
  copyDir?: DirCopier;
  /** Defaults to the real bundled assets alongside this module (src/rendering/assets in dev,
   * dist/rendering/assets once built — see scripts/copy-assets.mjs). */
  assetsDir?: string;
}

export interface AssembleResult {
  /** Absolute path to the output directory. */
  dir: string;
  /** Absolute path to the page within it. */
  indexPath: string;
}

const DEFAULT_ASSETS_DIR = fileURLToPath(new URL("./assets", import.meta.url));

/**
 * Writes the rendered `page` plus the bundled assets (CSS, JS, vendored mermaid — task 7.1) into
 * a fresh OS temp directory, and logs how to open it — the epic's "Result": a temp directory
 * with the ready HTML page and open-in-browser instructions.
 */
export async function assembleOutput(
  page: string,
  deps: AssembleDeps = {},
): Promise<AssembleResult> {
  const logger = deps.logger ?? createLogger();
  const makeTempDir = deps.mkdtemp ?? defaultMkdtemp;
  const write = deps.writeFile ?? defaultWriteFile;
  const copyDir = deps.copyDir ?? defaultCopyDir;
  const assetsDir = deps.assetsDir ?? DEFAULT_ASSETS_DIR;

  const dir = await makeTempDir();
  const indexPath = join(dir, "index.html");

  await write(indexPath, page);
  await copyDir(assetsDir, join(dir, "assets"));

  logger.info(`explanation page ready — open file://${indexPath} in your browser`);
  return { dir, indexPath };
}

async function defaultMkdtemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tulip-render-"));
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
}

async function defaultCopyDir(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
}
