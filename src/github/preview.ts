import { config } from "../config.js";
import { COMMIT_SHA_PATTERN, shortSha } from "../forge/sha.js";
import type { PreparedPreview, Preview, PrRef, PublishedPreview } from "../forge/types.js";
import { errorMessage } from "../logging/error-message.js";
import { runCommand } from "../process/exec.js";
import { type CommandRunner, type GhApi, GhApiError, ghApi, ghGraphql } from "./gh.js";
import { checkGhAuth } from "./gh-auth.js";
import { githubPrLabel } from "./pr-url.js";
import {
  buildPreviewComment,
  buildSupersededComment,
  PREVIEW_MARKER,
  type PreviewEntry,
  previewEntries,
} from "./preview-comment.js";

export interface PreviewDeps {
  runGh?: CommandRunner;
}

// The page upload is megabytes, too much for the default timeout on a slow connection.
const runGhForPreview: CommandRunner = (args) =>
  runCommand("gh", args, { timeoutMs: config.preview.ghCommandTimeoutMs });

interface PullState {
  state: string;
  locked: boolean;
  headSha: string;
}

/** The fork, if needed, is created on publish. */
export async function preparePreview(
  typedPr: PrRef,
  deps: PreviewDeps = {},
): Promise<PreparedPreview> {
  const runGh = deps.runGh ?? runGhForPreview;
  await checkGhAuth(typedPr.host, runGh);
  const api = ghApi(typedPr.host, runGh);
  const [repo, pull] = await Promise.all([
    api(`repos/${typedPr.repoPath}`, {
      jq: "{fullName: .full_name, push: .permissions.push, allowForking: .allow_forking, archived}",
    }).then(
      (json) =>
        JSON.parse(json) as {
          fullName: string;
          push?: boolean;
          allowForking?: boolean;
          archived?: boolean;
        },
    ),
    fetchPull(api, typedPr),
  ]);
  // GitHub follows a renamed repo's old name, and any case, for reads but not writes; and links in
  // the comment are compared by repo name. So everything after this uses the canonical name.
  const pr = { ...typedPr, repoPath: repo.fullName };

  if (repo.archived) {
    throw new Error(`${pr.repoPath} is archived`);
  }
  assertOpen(pr, pull);
  if (pull.locked && !repo.push) {
    throw new Error(`${githubPrLabel(pr)} is locked to collaborators`);
  }
  // `allow_forking` is only reported for some repos; absent means forking is worth trying.
  if (!repo.push && repo.allowForking === false) {
    throw new Error(`you can't push to ${pr.repoPath}, and it doesn't allow forks`);
  }

  const useFork = !repo.push;
  return {
    ...(useFork && {
      notice: `no push access to ${pr.repoPath}; the preview goes to your fork of it (created if needed)`,
    }),
    publish: (preview, signal) =>
      publishPreview(
        // A stop request takes effect before the next call.
        (endpoint, request) => {
          signal?.throwIfAborted();
          return api(endpoint, request);
        },
        pr,
        useFork,
        preview,
      ),
  };
}

async function publishPreview(
  api: GhApi,
  pr: PrRef,
  useFork: boolean,
  preview: Preview,
): Promise<PublishedPreview> {
  const [pull, latestComment] = await Promise.all([
    fetchPull(api, pr),
    fetchLatestPreviewComment(api, pr),
  ]);
  assertOpen(pr, pull);
  // A preview of an older commit would otherwise replace the newer one as the current comment.
  if (pull.headSha !== preview.headSha) {
    throw new Error(
      `${githubPrLabel(pr)} has moved to ${shortSha(pull.headSha)} since this preview of ` +
        `${shortSha(preview.headSha)} was made; run tulip again`,
    );
  }

  const fork = useFork ? await forkOf(api, pr) : undefined;
  const storeRepo = fork?.fullName ?? pr.repoPath;
  const previewUrl = await storePreviewFile(api, pr, storeRepo, preview).catch((error: unknown) => {
    throw fork?.isNew && isNotReady(error)
      ? new Error(`your fork ${fork.fullName} is still being created; retry in a minute`)
      : error;
  });
  const current = {
    sha: preview.headSha,
    url: previewUrl,
    generatedAt: preview.generatedAt.toISOString(),
  };
  return { previewUrl, ...(await postPreviewComment(api, pr, storeRepo, current, latestComment)) };
}

async function fetchPull(api: GhApi, pr: PrRef): Promise<PullState> {
  return JSON.parse(
    await api(`repos/${pr.repoPath}/pulls/${pr.number}`, {
      jq: "{state, locked, headSha: .head.sha}",
    }),
  ) as PullState;
}

function assertOpen(pr: PrRef, pull: PullState): void {
  if (pull.state !== "open") {
    throw new Error(`${githubPrLabel(pr)} is ${pull.state}`);
  }
}

/** POST /forks also returns an existing fork, under whatever name it has now. */
async function forkOf(api: GhApi, pr: PrRef): Promise<{ fullName: string; isNew: boolean }> {
  try {
    const fork = JSON.parse(
      await api(`repos/${pr.repoPath}/forks`, {
        method: "POST",
        body: { default_branch_only: true },
        jq: "{fullName: .full_name, createdAt: .created_at}",
      }),
    ) as { fullName: string; createdAt: string };
    const age = Date.now() - Date.parse(fork.createdAt);
    return { fullName: fork.fullName, isNew: age < config.preview.newForkMs };
  } catch (error) {
    throw new Error(`forking ${pr.repoPath} failed: ${errorMessage(error)}`);
  }
}

/** One orphan commit per preview, under its own ref; resolves with the file's web URL, pinned to
 * that commit. */
async function storePreviewFile(
  api: GhApi,
  pr: PrRef,
  storeRepo: string,
  preview: Preview,
): Promise<string> {
  const repo = `repos/${storeRepo}`;
  const file = previewFileName(pr.number, preview.headSha);

  const blobSha = await api(`${repo}/git/blobs`, {
    method: "POST",
    body: { content: preview.page, encoding: "utf-8" },
    jq: ".sha",
  });
  const treeSha = await api(`${repo}/git/trees`, {
    method: "POST",
    body: { tree: [{ path: file, mode: "100644", type: "blob", sha: blobSha }] },
    jq: ".sha",
  });
  const commitSha = await api(`${repo}/git/commits`, {
    method: "POST",
    body: {
      message: `Tulip preview of ${githubPrLabel(pr)} at ${shortSha(preview.headSha)}`,
      tree: treeSha,
      parents: [],
    },
    jq: ".sha",
  });
  // Named after the commit, so it's never moved: another user's comment, or an earlier one of
  // this user's, keeps a working link.
  await api(`${repo}/git/refs`, {
    method: "POST",
    body: { ref: `${config.preview.refPrefix}/pr-${pr.number}/${commitSha}`, sha: commitSha },
  });
  return previewFileUrl(pr.host, storeRepo, commitSha, file);
}

function previewFileName(prNumber: number, headSha: string): string {
  return `tulip-pr-${prNumber}-${shortSha(headSha)}.html`;
}

function previewFileUrl(host: string, repo: string, commitSha: string, file: string): string {
  return `https://${host}/${repo}/blob/${commitSha}/${file}`;
}

/** Whether the entry links exactly a file `storePreviewFile` could have stored for this PR's
 * entry.sha, in one of `repos`. */
function isPreviewFileLink(entry: PreviewEntry, pr: PrRef, repos: string[]): boolean {
  const commitSha = entry.url.split("/").at(-2) ?? "";
  const file = previewFileName(pr.number, entry.sha);
  return (
    COMMIT_SHA_PATTERN.test(commitSha) &&
    repos.some((repo) => entry.url === previewFileUrl(pr.host, repo, commitSha, file))
  );
}

/** A just-created fork answers writes with 404 or 409 until GitHub has copied the repo, which
 * GitHub says can take up to five minutes. An older fork's 404 is a real error. */
function isNotReady(error: unknown): boolean {
  return error instanceof GhApiError && (error.status === 404 || error.status === 409);
}

interface PreviewComment {
  id: string;
  databaseId: number;
  url: string;
  body: string;
  isMinimized: boolean;
  viewerDidAuthor: boolean;
  viewerCanMinimize: boolean;
}

/** Only the last 100 comments are searched: on a busier PR an older preview comment is missed,
 * and a new one is posted. */
async function fetchLatestPreviewComment(
  api: GhApi,
  pr: PrRef,
): Promise<PreviewComment | undefined> {
  const [owner, name] = pr.repoPath.split("/");
  const data = await ghGraphql<{
    repository: { pullRequest: { comments: { nodes: PreviewComment[] } } };
  }>(
    api,
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          comments(last: 100) {
            nodes { id databaseId url body isMinimized viewerDidAuthor viewerCanMinimize }
          }
        }
      }
    }`,
    { owner, name, number: pr.number },
  );
  return data.repository.pullRequest.comments.nodes.findLast(
    (comment) => comment.viewerDidAuthor && comment.body.includes(PREVIEW_MARKER),
  );
}

/** Edits the user's comment when it already shows this commit; otherwise posts a new one, which
 * notifies reviewers, and retires the old. */
async function postPreviewComment(
  api: GhApi,
  pr: PrRef,
  storeRepo: string,
  current: PreviewEntry,
  latest: PreviewComment | undefined,
): Promise<{ commentUrl: string; warnings: string[] }> {
  // A hidden comment isn't edited or retired, but its list of previews is still carried over.
  const active = latest?.isMinimized ? undefined : latest;
  // The state is in a comment others with write access can edit, so only links Tulip itself could
  // have written are carried over.
  const earlier = (latest ? previewEntries(latest.body) : []).filter((entry) =>
    isPreviewFileLink(entry, pr, [pr.repoPath, storeRepo]),
  );
  const body = buildPreviewComment(current, earlier);

  if (active && earlier[0]?.sha === current.sha) {
    const commentUrl = await api(`repos/${pr.repoPath}/issues/comments/${active.databaseId}`, {
      method: "PATCH",
      body: { body },
      jq: ".html_url",
    });
    return { commentUrl, warnings: [] };
  }

  const commentUrl = await api(`repos/${pr.repoPath}/issues/${pr.number}/comments`, {
    method: "POST",
    body: { body },
    jq: ".html_url",
  });
  return { commentUrl, warnings: active ? await retire(api, pr, active, commentUrl) : [] };
}

/** Minimizing needs write or triage access; without it, the author can still edit the comment
 * down to a pointer. */
async function retire(
  api: GhApi,
  pr: PrRef,
  comment: PreviewComment,
  replacementUrl: string,
): Promise<string[]> {
  try {
    if (comment.viewerCanMinimize) {
      await ghGraphql(
        api,
        `mutation($id: ID!) {
          minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) { clientMutationId }
        }`,
        { id: comment.id },
      );
    } else {
      await api(`repos/${pr.repoPath}/issues/comments/${comment.databaseId}`, {
        method: "PATCH",
        body: { body: buildSupersededComment(replacementUrl) },
      });
    }
    return [];
  } catch (error) {
    return [`couldn't retire the earlier preview comment ${comment.url}: ${errorMessage(error)}`];
  }
}
