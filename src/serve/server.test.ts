import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import type { Logger } from "../logging/logger.js";
import { createReviewServer, serveForReview } from "./server.js";

const PR_URL = "https://github.com/owner/repo/pull/42";
const CATEGORY_NAMES = ["Refactoring", "Bug fixes"];

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tulip-serve-test-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>page</title>");
  const assets = path.join(dir, "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "style.css"), "body{color:red}");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Starts a server on an ephemeral 127.0.0.1 port and returns its base URL + a closer. */
async function start(
  postComment: (prUrl: string, body: string) => Promise<string>,
): Promise<{ base: string; port: number; server: http.Server; close: () => Promise<void> }> {
  const server = createReviewServer({
    dir,
    prUrl: PR_URL,
    categoryNames: CATEGORY_NAMES,
    postComment,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo");
  }
  const port = address.port;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) {
    await close();
  }
  closers = [];
});

/** Convenience: start a server, register its closer, return the harness. */
async function serve(
  postComment = vi.fn(async () => "https://github.com/owner/repo/pull/42#issuecomment-1"),
) {
  const h = await start(postComment);
  closers.push(h.close);
  return { ...h, postComment };
}

/** Raw node:http request with fully caller-controlled headers (fetch can't override Host/omit Origin). */
function rawRequest(
  port: number,
  options: { method: string; path: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("createReviewServer POST /api/comment", () => {
  it("posts one comment built server-side and returns {url}", async () => {
    const { base, postComment } = await serve();

    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIndex: 1, text: "  looks good  " }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://github.com/owner/repo/pull/42#issuecomment-1",
    });
    expect(postComment).toHaveBeenCalledTimes(1);
    expect(postComment).toHaveBeenCalledWith(
      PR_URL,
      "*Comment from Tulip's PR explanation, for the category: Bug fixes*\n\nlooks good",
    );
  });

  it("rejects a categoryIndex out of range with 400 and posts nothing", async () => {
    const { base, postComment } = await serve();
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIndex: 2, text: "hi" }),
    });
    expect(res.status).toBe(400);
    expect(postComment).not.toHaveBeenCalled();
  });

  it('rejects a non-integer categoryIndex (1.5 and "0") with 400', async () => {
    const { base } = await serve();
    for (const categoryIndex of [1.5, "0"]) {
      const res = await fetch(`${base}/api/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIndex, text: "hi" }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects empty/whitespace text with 400", async () => {
    const { base, postComment } = await serve();
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIndex: 0, text: "   " }),
    });
    expect(res.status).toBe(400);
    expect(postComment).not.toHaveBeenCalled();
  });

  it("rejects text over the cap with 400", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryIndex: 0,
        text: "x".repeat(config.serve.maxCommentChars + 1),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
  });

  it("rejects a cross-origin POST with 403 and posts nothing", async () => {
    const { base, postComment } = await serve();
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ categoryIndex: 0, text: "hi" }),
    });
    expect(res.status).toBe(403);
    expect(postComment).not.toHaveBeenCalled();
  });

  it("allows a POST with no Origin header (200)", async () => {
    const { port } = await serve();
    const res = await rawRequest(port, {
      method: "POST",
      path: "/api/comment",
      headers: { Host: `127.0.0.1:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIndex: 0, text: "hi" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 500 {error} without a stack when postComment rejects", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom stack detail");
    });
    const { base } = await serve(failing);
    const res = await fetch(`${base}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIndex: 0, text: "hi" }),
    });
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe("failed to post comment");
    expect(payload.error).not.toContain("boom");
  });
});

describe("createReviewServer request guards", () => {
  it("rejects a request whose Host header is not 127.0.0.1:<port> with 403", async () => {
    const { port } = await serve();
    const res = await rawRequest(port, {
      method: "GET",
      path: "/",
      headers: { Host: "evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("serves the index page for GET /", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("<title>page</title>");
  });

  it("serves an asset with the right content-type", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  it("blocks path traversal, literal and percent-encoded", async () => {
    const { port } = await serve();
    // Percent-encoded `..` survives URL parsing, so the resolve+confine guard rejects it (403).
    const encoded = await rawRequest(port, {
      method: "GET",
      path: "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      headers: { Host: `127.0.0.1:${port}` },
    });
    expect(encoded.status).toBe(403);
    // Literal `..` is normalized away by the WHATWG URL parser to an in-dir path, so it can't
    // escape either — it just 404s. The security property (never served) holds for both.
    const literal = await rawRequest(port, {
      method: "GET",
      path: "/../../etc/passwd",
      headers: { Host: `127.0.0.1:${port}` },
    });
    expect(literal.status).toBe(404);
    expect(literal.body).not.toContain("root:");
  });

  it("returns 404 for a missing file", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/nope.html`);
    expect(res.status).toBe(404);
  });
});

describe("serveForReview lifecycle", () => {
  afterEach(() => {
    // Remove any handler a failed run might have left behind.
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  it("listens, logs readiness, and removes its signal handlers on SIGINT", async () => {
    const info = vi.fn();
    const logger: Logger = { info, debug: vi.fn() };
    const openInBrowser = vi.fn(async () => {});
    const postComment = vi.fn(async () => "url");

    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const done = serveForReview({
      dir,
      prUrl: PR_URL,
      categoryNames: CATEGORY_NAMES,
      postComment,
      logger,
      open: false,
      openInBrowser,
    });

    // Let listen()'s callback run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(info).toHaveBeenCalledWith(expect.stringContaining("review server ready"));
    expect(openInBrowser).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    process.emit("SIGINT");
    await done;

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("closes idle keep-alive connections on shutdown so close() resolves promptly", async () => {
    const closeIdle = vi.spyOn(http.Server.prototype, "closeIdleConnections");
    try {
      const done = serveForReview({
        dir,
        prUrl: PR_URL,
        categoryNames: CATEGORY_NAMES,
        postComment: vi.fn(async () => "url"),
        logger: { info: vi.fn(), debug: vi.fn() },
        open: false,
        openInBrowser: vi.fn(async () => {}),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      process.emit("SIGINT");
      await done;

      // Without this, close() would wait out the browser's keep-alive socket before resolving.
      expect(closeIdle).toHaveBeenCalled();
    } finally {
      closeIdle.mockRestore();
    }
  });
});
