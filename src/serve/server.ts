import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { config } from "../config.js";
import { postPrComment } from "../github/pr-comment.js";
import { createLogger, type Logger } from "../logging/logger.js";

/** What {@link createReviewServer} needs: the render temp dir to serve, the PR to post to, the
 * ordered category names a `categoryIndex` is validated against, and injectable seams. */
export interface ReviewServerOptions {
  /** Absolute path of the already-rendered temp dir (`index.html` + `assets/`). */
  dir: string;
  /** The PR every comment is posted to. Fixed here — a request can't name another repo/PR. */
  prUrl: string;
  /** Category names in render order; the POST body's `categoryIndex` indexes into this. */
  categoryNames: string[];
  /** Posts a comment; defaults to {@link postPrComment}. Injected in tests. */
  postComment?: (prUrl: string, body: string) => Promise<string>;
  logger?: Logger;
}

/** Maps a file extension to a Content-Type. Unknown → `application/octet-stream`. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

/**
 * Builds the localhost review server: serves the static render dir and posts per-category PR
 * comments via `POST /api/comment`. No signal handlers and no browser open — those live in
 * {@link serveForReview}, so request-behavior tests can drive this directly on an ephemeral port.
 *
 * Security: every request must carry `Host: 127.0.0.1:<port>` (DNS-rebinding guard), POSTs with a
 * present-but-foreign `Origin` are rejected, static paths are confined to `dir` (traversal guard),
 * and the request body is size-bounded.
 */
export function createReviewServer(opts: ReviewServerOptions): http.Server {
  const postComment = opts.postComment ?? postPrComment;
  const logger = opts.logger ?? createLogger();
  const dir = path.resolve(opts.dir);

  return http.createServer((req, res) => {
    // Per-request, so the guards need no pre-known port (works on an ephemeral port).
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    const expectedOrigin = `http://${expectedHost}`;

    // DNS-rebinding guard, covering GET too. Strict: a manual visit to `localhost:<port>` (rather
    // than `127.0.0.1:<port>`) also 403s — harmless, since serveForReview opens the 127.0.0.1 URL.
    if (req.headers.host !== expectedHost) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    if (req.method === "GET") {
      void handleGet(req, res, dir);
      return;
    }

    if (
      req.method === "POST" &&
      (req.url === "/api/comment" || req.url?.startsWith("/api/comment?"))
    ) {
      void handleComment(req, res, opts, postComment, logger, expectedOrigin);
      return;
    }

    if (req.method === "POST") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    sendJson(res, 405, { error: "method not allowed" });
  });
}

/** Serves a file from `dir`. The whole path (decode + resolve + read) is wrapped so a malformed
 * request can never crash the long-running server with an uncaught sync throw. */
async function handleGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dir: string,
): Promise<void> {
  try {
    const rawPathname = new URL(req.url ?? "/", "http://x").pathname;
    const pathname = decodeURIComponent(rawPathname); // malformed `%` → URIError → 400 below
    const requested = pathname === "/" ? "/index.html" : pathname;
    const full = path.resolve(dir, `.${requested}`);
    if (full !== dir && !full.startsWith(dir + path.sep)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    let content: Buffer;
    try {
      content = await readFile(full);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // EISDIR: GET /assets or /assets/vendor — real dirs in the render output.
      if (code === "ENOENT" || code === "EISDIR") {
        sendJson(res, 404, { error: "not found" });
      } else {
        sendJson(res, 500, { error: "internal error" });
      }
      return;
    }

    const type = CONTENT_TYPES[path.extname(full)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    // URIError from decodeURIComponent, or any other sync throw building the path.
    sendJson(res, 400, { error: "bad request" });
  }
}

/** Handles `POST /api/comment`: validates the body, builds the comment server-side, posts it. */
async function handleComment(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ReviewServerOptions,
  postComment: (prUrl: string, body: string) => Promise<string>,
  logger: Logger,
  expectedOrigin: string,
): Promise<void> {
  // Absent Origin is allowed (Host guard + random port already cover the no-Origin case); a
  // present-but-foreign Origin is a cross-site driver → reject.
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== expectedOrigin) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  const cap = config.serve.maxRequestBodyBytes;
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > cap) {
    sendJson(res, 413, { error: "payload too large" });
    return;
  }

  let raw: string;
  try {
    raw = await readBoundedBody(req, res, cap);
  } catch {
    return; // readBoundedBody already responded (413) and destroyed the request.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }

  const { categoryIndex, text } = parsed as { categoryIndex?: unknown; text?: unknown };
  if (
    !Number.isInteger(categoryIndex) ||
    (categoryIndex as number) < 0 ||
    (categoryIndex as number) >= opts.categoryNames.length
  ) {
    sendJson(res, 400, { error: "invalid categoryIndex" });
    return;
  }

  if (typeof text !== "string") {
    sendJson(res, 400, { error: "invalid text" });
    return;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > config.serve.maxCommentChars) {
    sendJson(res, 400, { error: "invalid text" });
    return;
  }

  const category = opts.categoryNames[categoryIndex as number];
  const body = `*Comment from Tulip's PR explanation, for the category: ${category}*\n\n${trimmed}`;
  try {
    const url = await postComment(opts.prUrl, body);
    sendJson(res, 200, { url });
  } catch (error) {
    // Detail stays in the log; the response never carries it (no stack leak to the browser).
    logger.info(
      `failed to post PR comment: ${error instanceof Error ? error.message : String(error)}`,
    );
    sendJson(res, 500, { error: "failed to post comment" });
  }
}

/** Reads the request body as a string, aborting with 413 if the streamed bytes exceed `cap` (even
 * when Content-Length lied or was absent). Rejects once it has responded, so the caller stops. */
function readBoundedBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cap: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        sendJson(res, 413, { error: "payload too large" });
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** {@link serveForReview} options: a review server plus how to open the page. */
export type ServeOptions = ReviewServerOptions & {
  /** Open the `http://` URL in the browser once listening. */
  open: boolean;
  /** Browser opener; defaults to spawning the OS opener. Injected in tests / by the pipeline. */
  openInBrowser?: (url: string) => Promise<void>;
};

/**
 * Runs the review server until SIGINT/SIGTERM, then closes it and resolves — so a caller's own
 * cleanup (`finally`) runs once, after Ctrl+C. Both signal handlers are removed on shutdown, so
 * repeated in-process runs (tests) don't leak listeners.
 */
export function serveForReview(opts: ServeOptions): Promise<void> {
  const logger = opts.logger ?? createLogger();
  const server = createReviewServer(opts);

  return new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      // Close idle keep-alive sockets (e.g. the still-open browser page) first, so close()'s
      // callback fires promptly instead of waiting out keepAliveTimeout — otherwise Ctrl+C appears
      // to hang, and a second Ctrl+C during the wait would hit Node's default handler and hard-exit
      // before the caller's checkout cleanup runs.
      server.closeIdleConnections();
      server.close(() => resolve());
    };

    server.on("error", (error) => {
      // A listen failure never reaches `shutdown`, so drop the handlers here too — they'd otherwise
      // leak across repeated in-process runs (tests).
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}`;
      logger.info(`review server ready — open ${url} (Ctrl+C to stop)`);
      if (opts.open) {
        void (opts.openInBrowser ?? defaultOpenInBrowser)(url).catch(() => {
          // Opening the browser is best-effort; the URL is logged above as a fallback.
        });
      }
    });

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

/** Fallback opener, mirroring src/pipeline/run.ts's `defaultOpenInBrowser`: spawns the OS's own
 * "open a URL" command with the URL as a separate argv element (no shell, no injection surface).
 * The pipeline passes its own opener in — this is only used when none is injected. */
const defaultOpenInBrowser = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const { command, args } = openCommandFor(process.platform, url);
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

function openCommandFor(
  platform: NodeJS.Platform,
  target: string,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [target] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", target] };
  }
  return { command: "xdg-open", args: [target] };
}
