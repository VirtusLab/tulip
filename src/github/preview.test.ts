import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { PrRef } from "../forge/types.js";
import { preparePreview } from "./preview.js";
import { buildPreviewComment, buildSupersededComment } from "./preview-comment.js";

const PR: PrRef = { forge: "github", host: "github.com", repoPath: "octo/widgets", number: 42 };
const HEAD_SHA = "c".repeat(40);
const OLD_SHA = "d".repeat(40);
const FILE = "tulip-pr-42-ccccccc.html";
const COMMIT = "f".repeat(40);
const PREVIEW_URL = `https://github.com/octo/widgets/blob/${COMMIT}/${FILE}`;
const REF = `refs/tulip/previews/pr-42/${COMMIT}`;
const STORED_COMMIT = "e".repeat(40);

interface GhCall {
  method: string;
  endpoint: string;
  body?: unknown;
}

type Response = string | ((body: unknown) => string);

/** Answers `gh api` by "METHOD endpoint" (GraphQL by "query"/"mutation"), and `gh auth status`
 * with success; records each API call with its --input body. */
function fakeGh(responses: Record<string, Response>) {
  const calls: GhCall[] = [];
  const runGh = vi.fn(async (args: string[]) => {
    if (args[0] === "auth") {
      return "";
    }
    const methodIndex = args.indexOf("--method");
    const method = args[methodIndex + 1] as string;
    const endpoint = args[methodIndex + 2] as string;
    const inputIndex = args.indexOf("--input");
    const body =
      inputIndex === -1
        ? undefined
        : JSON.parse(await readFile(args[inputIndex + 1] as string, "utf8"));
    calls.push({ method, endpoint, ...(body !== undefined && { body }) });
    const key =
      endpoint === "graphql"
        ? (body as { query: string }).query.trimStart().split(/[\s(]/)[0]
        : `${method} ${endpoint}`;
    const response = responses[key as string];
    if (response === undefined) {
      throw new Error(`unexpected gh api ${key}`);
    }
    return `${typeof response === "function" ? response(body) : response}\n`;
  });
  const bodyOf = (method: string, endpoint: string) =>
    calls.find((call) => call.method === method && call.endpoint === endpoint)?.body;
  return { runGh, calls, bodyOf };
}

function ghError(message: string, status: number): Error {
  return Object.assign(new Error("Command failed"), { stderr: `gh: ${message} (HTTP ${status})` });
}

interface FakeComment {
  id: string;
  databaseId: number;
  url: string;
  body: string;
  isMinimized?: boolean;
  viewerDidAuthor?: boolean;
  viewerCanMinimize?: boolean;
}

function commentsResponse(comments: FakeComment[]): string {
  const nodes = comments.map((comment) => ({
    isMinimized: false,
    viewerDidAuthor: true,
    viewerCanMinimize: true,
    ...comment,
  }));
  return JSON.stringify({ repository: { pullRequest: { comments: { nodes } } } });
}

function previewComment(sha: string, overrides: Partial<FakeComment> = {}): FakeComment {
  return {
    id: "IC_old",
    databaseId: 7,
    url: "https://github.com/octo/widgets/pull/42#issuecomment-7",
    body: buildPreviewComment(
      {
        sha,
        url: `https://github.com/octo/widgets/blob/${STORED_COMMIT}/tulip-pr-42-${sha.slice(0, 7)}.html`,
        generatedAt: "2026-10-18T09:00:00.000Z",
      },
      "gh api ...",
      [],
    ),
    ...overrides,
  };
}

const REPO_WITH_PUSH =
  '{"fullName":"octo/widgets","push":true,"allowForking":true,"archived":false}';
const OPEN_PULL = JSON.stringify({ state: "open", locked: false, headSha: HEAD_SHA });

const PUBLISH = {
  "GET repos/octo/widgets": REPO_WITH_PUSH,
  "GET repos/octo/widgets/pulls/42": OPEN_PULL,
  "POST repos/octo/widgets/git/blobs": "blob-sha",
  "POST repos/octo/widgets/git/trees": "tree-sha",
  "POST repos/octo/widgets/git/commits": COMMIT,
  "POST repos/octo/widgets/git/refs": "{}",
  query: commentsResponse([]),
  "POST repos/octo/widgets/issues/42/comments":
    "https://github.com/octo/widgets/pull/42#issuecomment-1",
} satisfies Record<string, Response>;

async function publish(runGh: (args: string[]) => Promise<string>, signal?: AbortSignal) {
  const prepared = await preparePreview(PR, { runGh });
  return prepared.publish(
    {
      page: "<html>preview</html>",
      headSha: HEAD_SHA,
      generatedAt: new Date("2026-10-19T14:32:00Z"),
    },
    signal,
  );
}

function forkResponse(createdAt: Date): string {
  return JSON.stringify({ fullName: "me/widgets", createdAt: createdAt.toISOString() });
}

const FORK_STORE = {
  "GET repos/octo/widgets":
    '{"fullName":"octo/widgets","push":false,"allowForking":true,"archived":false}',
  "POST repos/me/widgets/git/trees": "tree-sha",
  "POST repos/me/widgets/git/commits": COMMIT,
  "POST repos/me/widgets/git/refs": "{}",
};

describe("preparePreview", () => {
  it("checks gh auth for the PR's host first", async () => {
    const { runGh } = fakeGh(PUBLISH);

    await preparePreview(PR, { runGh });

    expect(runGh.mock.calls[0]?.[0]).toEqual(["auth", "status", "--hostname", "github.com"]);
  });

  it("stores in the PR's repo, with no notice and no writes, when the user can push", async () => {
    const { runGh, calls } = fakeGh(PUBLISH);

    const prepared = await preparePreview(PR, { runGh });

    expect(prepared.notice).toBeUndefined();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("plans for a fork, without creating it, when the user can't push", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      "GET repos/octo/widgets":
        '{"fullName":"octo/widgets","push":false,"allowForking":null,"archived":false}',
    });

    const prepared = await preparePreview(PR, { runGh });

    expect(prepared.notice).toBe(
      "no push access to octo/widgets; the preview goes to your fork of it (created if needed)",
    );
    expect(calls.some((call) => call.endpoint.endsWith("/forks"))).toBe(false);
  });

  it.each([
    [
      "the repo doesn't allow forks",
      {
        "GET repos/octo/widgets":
          '{"fullName":"octo/widgets","push":false,"allowForking":false,"archived":false}',
      },
      "you can't push to octo/widgets, and it doesn't allow forks",
    ],
    [
      "the repo is archived",
      {
        "GET repos/octo/widgets":
          '{"fullName":"octo/widgets","push":true,"allowForking":true,"archived":true}',
      },
      "octo/widgets is archived",
    ],
    [
      "the PR is closed",
      { "GET repos/octo/widgets/pulls/42": '{"state":"closed","locked":false,"headSha":"x"}' },
      "octo/widgets#42 is closed",
    ],
    [
      "the PR is locked and the user can't push",
      {
        "GET repos/octo/widgets":
          '{"fullName":"octo/widgets","push":false,"allowForking":true,"archived":false}',
        "GET repos/octo/widgets/pulls/42": JSON.stringify({
          state: "open",
          locked: true,
          headSha: HEAD_SHA,
        }),
      },
      "octo/widgets#42 is locked to collaborators",
    ],
  ])("refuses when %s", async (_, overrides, message) => {
    const { runGh } = fakeGh({ ...PUBLISH, ...overrides });

    await expect(preparePreview(PR, { runGh })).rejects.toThrow(message);
  });
});

describe("publish", () => {
  it("stores the page as an orphan commit under its own ref and posts a new comment", async () => {
    const { runGh, bodyOf } = fakeGh(PUBLISH);

    const result = await publish(runGh);

    expect(result).toEqual({
      commentUrl: "https://github.com/octo/widgets/pull/42#issuecomment-1",
      previewUrl: PREVIEW_URL,
      warnings: [],
    });
    expect(bodyOf("POST", "repos/octo/widgets/git/blobs")).toEqual({
      content: "<html>preview</html>",
      encoding: "utf-8",
    });
    expect(bodyOf("POST", "repos/octo/widgets/git/trees")).toEqual({
      tree: [{ path: FILE, mode: "100644", type: "blob", sha: "blob-sha" }],
    });
    expect(bodyOf("POST", "repos/octo/widgets/git/commits")).toEqual({
      message: "Tulip preview of octo/widgets#42 at ccccccc",
      tree: "tree-sha",
      parents: [],
    });
    expect(bodyOf("POST", "repos/octo/widgets/git/refs")).toEqual({ ref: REF, sha: COMMIT });
    expect(bodyOf("POST", "repos/octo/widgets/issues/42/comments")).toEqual({
      body: buildPreviewComment(
        { sha: HEAD_SHA, url: PREVIEW_URL, generatedAt: "2026-10-19T14:32:00.000Z" },
        `gh api 'repos/octo/widgets/contents/${FILE}?ref=${COMMIT}' ` +
          `-H 'Accept: application/vnd.github.raw' > ${FILE}`,
        [],
      ),
    });
  });

  it("names a GitHub Enterprise host in the download command", async () => {
    const { runGh, bodyOf } = fakeGh(PUBLISH);
    const prepared = await preparePreview({ ...PR, host: "git.xyz.com" }, { runGh });

    await prepared.publish({ page: "<html/>", headSha: HEAD_SHA, generatedAt: new Date() });

    const posted = bodyOf("POST", "repos/octo/widgets/issues/42/comments") as { body: string };
    expect(posted.body).toContain(
      `-H 'Accept: application/vnd.github.raw' --hostname git.xyz.com > ${FILE}\n`,
    );
  });

  it("refuses a commit SHA that could break the download command", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      "POST repos/octo/widgets/git/commits": "x' && rm -rf ~ #",
    });

    await expect(publish(runGh)).rejects.toThrow("unexpected preview location");
    expect(calls.some((call) => call.endpoint.endsWith("/refs"))).toBe(false);
  });

  it("never moves an existing ref, so earlier links keep working", async () => {
    const { runGh, calls } = fakeGh(PUBLISH);

    await publish(runGh);

    expect(
      calls.some((call) => call.method === "PATCH" && call.endpoint.includes("/git/refs")),
    ).toBe(false);
  });

  it("uses the repo's canonical name, as typed differently or renamed, for every later call", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      "GET repos/Octo/Old-Widgets": REPO_WITH_PUSH,
      "GET repos/Octo/Old-Widgets/pulls/42": OPEN_PULL,
    });
    const prepared = await preparePreview({ ...PR, repoPath: "Octo/Old-Widgets" }, { runGh });

    await prepared.publish({ page: "<html></html>", headSha: HEAD_SHA, generatedAt: new Date() });

    const later = calls.slice(2).filter((call) => call.endpoint.startsWith("repos/"));
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((call) => call.endpoint.startsWith("repos/octo/widgets"))).toBe(true);
  });

  it("refuses, before writing anything, when the PR has moved on", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      "GET repos/octo/widgets/pulls/42": JSON.stringify({
        state: "open",
        locked: false,
        headSha: "e".repeat(40),
      }),
    });

    await expect(publish(runGh)).rejects.toThrow(
      "octo/widgets#42 has moved to eeeeeee since this preview of ccccccc was made",
    );
    const writes = calls.filter(
      (call) =>
        call.method !== "GET" &&
        !(
          call.endpoint === "graphql" && (call.body as { query: string }).query.startsWith("query")
        ),
    );
    expect(writes).toEqual([]);
  });

  it("edits the user's comment in place when it already shows this commit", async () => {
    const own = previewComment(HEAD_SHA);
    const { runGh, calls, bodyOf } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([own]),
      "PATCH repos/octo/widgets/issues/comments/7": own.url,
    });

    const result = await publish(runGh);

    expect(result.commentUrl).toBe(own.url);
    const patch = bodyOf("PATCH", "repos/octo/widgets/issues/comments/7") as { body: string };
    expect(patch.body).toContain(PREVIEW_URL);
    expect(calls.some((call) => call.endpoint === "repos/octo/widgets/issues/42/comments")).toBe(
      false,
    );
  });

  it("posts a new comment for a new commit, carrying the history, and minimizes the old one", async () => {
    const { runGh, calls, bodyOf } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([previewComment(OLD_SHA)]),
      mutation: '{"minimizeComment":{"clientMutationId":null}}',
    });

    const result = await publish(runGh);

    expect(result.warnings).toEqual([]);
    const posted = bodyOf("POST", "repos/octo/widgets/issues/42/comments") as { body: string };
    expect(posted.body).toContain("- `ddddddd` on 2026-10-18 09:00 UTC:");
    const mutation = calls.find((call) =>
      (call.body as { query?: string } | undefined)?.query?.includes("minimizeComment"),
    );
    expect(mutation?.body).toMatchObject({ variables: { id: "IC_old" } });
  });

  it("edits the old comment into a pointer when it can't be minimized", async () => {
    const { runGh, bodyOf } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([previewComment(OLD_SHA, { viewerCanMinimize: false })]),
      "PATCH repos/octo/widgets/issues/comments/7": "{}",
    });

    await publish(runGh);

    expect(bodyOf("PATCH", "repos/octo/widgets/issues/comments/7")).toEqual({
      body: buildSupersededComment("https://github.com/octo/widgets/pull/42#issuecomment-1"),
    });
  });

  it("reports a failure to retire the old comment as a warning", async () => {
    const { runGh } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([previewComment(OLD_SHA)]),
      mutation: () => {
        throw ghError("Forbidden", 403);
      },
    });

    const result = await publish(runGh);

    expect(result.commentUrl).toBe("https://github.com/octo/widgets/pull/42#issuecomment-1");
    expect(result.warnings).toEqual([
      "couldn't retire the earlier preview comment " +
        "https://github.com/octo/widgets/pull/42#issuecomment-7: Forbidden (HTTP 403)",
    ]);
  });

  it("posts a new comment, retiring nothing, when the user's latest one is already hidden", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([previewComment(HEAD_SHA, { isMinimized: true })]),
    });

    await publish(runGh);

    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(calls.at(-1)?.endpoint).toBe("repos/octo/widgets/issues/42/comments");
  });

  it("keeps the earlier previews listed in a hidden comment", async () => {
    const { runGh, bodyOf } = fakeGh({
      ...PUBLISH,
      query: commentsResponse([previewComment(OLD_SHA, { isMinimized: true })]),
    });

    await publish(runGh);

    const posted = bodyOf("POST", "repos/octo/widgets/issues/42/comments") as { body: string };
    expect(posted.body).toContain("- `ddddddd` on 2026-10-18 09:00 UTC:");
  });

  describe("carrying over history", () => {
    const OLD_URL = `https://github.com/octo/widgets/blob/${STORED_COMMIT}/tulip-pr-42-ddddddd.html`;

    async function carriedOver(url: string): Promise<boolean> {
      const comment = previewComment(OLD_SHA, {
        body: buildPreviewComment(
          { sha: OLD_SHA, url, generatedAt: "2026-10-18T09:00:00.000Z" },
          "gh api ...",
          [],
        ),
      });
      const { runGh, bodyOf } = fakeGh({
        ...PUBLISH,
        query: commentsResponse([comment]),
        mutation: "{}",
      });
      await publish(runGh);
      const posted = bodyOf("POST", "repos/octo/widgets/issues/42/comments") as { body: string };
      return posted.body.includes("- `ddddddd` on");
    }

    it("keeps a link to a stored preview file", async () => {
      expect(await carriedOver(OLD_URL)).toBe(true);
    });

    it.each([
      ["another file", OLD_URL.replace("tulip-pr-42-ddddddd", "secrets")],
      ["another PR", OLD_URL.replace("tulip-pr-42-", "tulip-pr-41-")],
      ["another head commit", OLD_URL.replace("ddddddd", "aaaaaaa")],
      ["a query", `${OLD_URL}?raw=true`],
      ["a fragment", `${OLD_URL}#x`],
      ["a dot segment", OLD_URL.replace("/blob/", "/blob/../../../evil/x/blob/")],
      ["an encoded dot segment", OLD_URL.replace("/blob/", "/blob/%2e%2e/")],
      ["an extra segment", OLD_URL.replace("/tulip-pr", "/dir/tulip-pr")],
      ["an uppercase commit", OLD_URL.replace(STORED_COMMIT, "E".repeat(40))],
      ["a short commit", OLD_URL.replace(STORED_COMMIT, "e".repeat(39))],
      ["a branch", OLD_URL.replace(STORED_COMMIT, "main")],
      ["another repo", OLD_URL.replace("octo/widgets", "attacker/widgets")],
      ["another repo case", OLD_URL.replace("octo/widgets", "Octo/widgets")],
      ["another host", OLD_URL.replace("github.com", "evil.example")],
      ["http", OLD_URL.replace("https:", "http:")],
      ["whitespace", `${OLD_URL} `],
    ])("drops a link with %s", async (_, url) => {
      expect(await carriedOver(url)).toBe(false);
    });
  });

  it("stores the page in a fork it just created", async () => {
    const { runGh, bodyOf } = fakeGh({
      ...PUBLISH,
      ...FORK_STORE,
      "POST repos/octo/widgets/forks": forkResponse(new Date()),
      "POST repos/me/widgets/git/blobs": "blob-sha",
    });

    const result = await publish(runGh);

    expect(bodyOf("POST", "repos/octo/widgets/forks")).toEqual({ default_branch_only: true });
    expect(result.previewUrl).toBe(`https://github.com/me/widgets/blob/${COMMIT}/${FILE}`);
  });

  it("asks to retry later when a fork it just created isn't ready yet", async () => {
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      ...FORK_STORE,
      "POST repos/octo/widgets/forks": forkResponse(new Date()),
      "POST repos/me/widgets/git/blobs": () => {
        throw ghError("Git Repository is empty.", 409);
      },
    });

    await expect(publish(runGh)).rejects.toThrow(
      "your fork me/widgets is still being created; retry in a minute",
    );
    expect(calls.filter((call) => call.endpoint === "repos/me/widgets/git/blobs")).toHaveLength(1);
  });

  it("reports a fork that already existed failing a write as is", async () => {
    const { runGh } = fakeGh({
      ...PUBLISH,
      ...FORK_STORE,
      "POST repos/octo/widgets/forks": forkResponse(new Date("2024-01-01T00:00:00Z")),
      "POST repos/me/widgets/git/blobs": () => {
        throw ghError("Not Found", 404);
      },
    });

    await expect(publish(runGh)).rejects.toThrow("Not Found (HTTP 404)");
  });

  it("stops before its next step once asked to", async () => {
    const stop = new AbortController();
    const { runGh, calls } = fakeGh({
      ...PUBLISH,
      "POST repos/octo/widgets/git/blobs": () => {
        stop.abort();
        return "blob-sha";
      },
    });

    await expect(publish(runGh, stop.signal)).rejects.toThrow();
    expect(calls.at(-1)?.endpoint).toBe("repos/octo/widgets/git/blobs");
  });

  it("reports a write to the PR's own repo failing as is", async () => {
    const { runGh } = fakeGh({
      ...PUBLISH,
      "POST repos/octo/widgets/git/blobs": () => {
        throw ghError("Not Found", 404);
      },
    });

    await expect(publish(runGh)).rejects.toThrow("Not Found (HTTP 404)");
  });
});
