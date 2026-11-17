import { shortSha } from "../forge/sha.js";
import type {
  PreparedPreview,
  Preview,
  PreviewPublisher,
  PrRef,
  PublishedPreview,
} from "../forge/types.js";
import { forgeFor } from "../forge-registry/registry.js";
import { errorMessage } from "../logging/error-message.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { readSignedPage } from "./page-signature.js";

export interface ShareDeps {
  forgeFor?: typeof forgeFor;
  logger?: Logger;
}

/** `tulip share`: publishes an earlier run's page on its PR (docs/adr/0032). */
export async function shareRun(
  location: string,
  keyPath: string,
  deps: ShareDeps = {},
): Promise<void> {
  const logger = deps.logger ?? createLogger();
  const run = await readSignedPage(location, keyPath);
  const adapter = (deps.forgeFor ?? forgeFor)(run.pr);
  if (!adapter.previewPublisher) {
    throw new Error(`sharing isn't supported for ${run.pr.forge} URLs`);
  }

  logger.info(`sharing ${adapter.label(run.pr)} at ${shortSha(run.preview.headSha)}...`);
  const prepared = await prepareAndLog(adapter.previewPublisher, run.pr, logger);
  await publishAndReport(prepared, run.preview, logger);
}

export async function prepareAndLog(
  publisher: PreviewPublisher,
  pr: PrRef,
  logger: Logger,
): Promise<PreparedPreview> {
  const prepared = await publisher.prepare(pr);
  if (prepared.notice) {
    logger.info(prepared.notice);
  }
  return prepared;
}

async function publishAndReport(
  prepared: PreparedPreview,
  preview: Preview,
  logger: Logger,
  signal?: AbortSignal,
): Promise<PublishedPreview> {
  const published = await prepared.publish(preview, signal);
  for (const warning of published.warnings) {
    logger.info(`warning: ${warning}`);
  }
  logger.info(`preview file: ${published.previewUrl}`);
  logger.info(`preview shared: ${published.commentUrl}`);
  return published;
}

export interface Share {
  (): Promise<PublishedPreview>;
  /** Stops the attempt in progress, between its steps, and any later one. */
  stop(): void;
  succeeded(): boolean;
}

/** One share per run, for every way of triggering it: a double click publishes once, and a
 * failure can be retried. */
export function createShare(options: {
  prepare: () => Promise<PreparedPreview>;
  preview: Preview;
  logger: Logger;
}): Share {
  const { prepare, preview, logger } = options;
  const stopping = new AbortController();
  let succeeded = false;
  const attempt = memoizeUntilSuccess(async () => {
    const published = await publishAndReport(await prepare(), preview, logger, stopping.signal);
    succeeded = true;
    return published;
  });
  return Object.assign(attempt, {
    stop: () => stopping.abort(),
    succeeded: () => succeeded,
  });
}

export function shareCommand(dir: string): string {
  return /^[\w./~-]+$/.test(dir)
    ? `tulip share ${dir}`
    : `tulip share '${dir.replace(/'/g, "'\\''")}'`;
}

/** Runs a first attempt, explaining how to retry with `pagePath` if it fails. Ctrl+C
 * stops it, rather than Node's default exiting before the run has cleaned up. */
export async function shareOrSuggestRetry(
  share: Share,
  pagePath: string,
  logger: Logger,
): Promise<void> {
  const stop = () => {
    logger.info("stopping the preview share...");
    share.stop();
  };
  process.on("SIGINT", stop);
  try {
    await share();
  } catch (error) {
    logger.info(`sharing the preview failed: ${errorMessage(error)}`);
    logger.info(`retry without re-running the analysis: ${shareCommand(pagePath)}`);
  } finally {
    process.off("SIGINT", stop);
  }
}

export function memoizeUntilSuccess<T>(attempt: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= attempt().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
