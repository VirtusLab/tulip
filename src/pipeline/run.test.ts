import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBinaryMissingError, AgentOutputError } from "../agent/errors.js";
import type { Agent, AgentBackend, ModelTokens } from "../agent/types.js";
import type { UsageLedger } from "../agent/usage.js";
import type { GenerateCategoriesResult } from "../categories/generate.js";
import type { CategoryReviewLoopResult } from "../categories/review.js";
import type { PrCheckout } from "../checkout/checkout.js";
import { IncompleteCoverageError } from "../classification/coverage.js";
import type { ClassifyChangesResult } from "../classification/orchestrate.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ParsedDiff } from "../diff/change.js";
import { SnippetCoverageError } from "../explanations/coverage.js";
import type { CategoryExplanation } from "../explanations/types.js";
import type {
  ForgeAdapter,
  PrCommenter,
  PreparedPreview,
  PreviewPublisher,
  PrMetadata,
  PrRef,
  PublishedPreview,
} from "../forge/types.js";
import { forgeFor } from "../forge-registry/registry.js";
import { gitlabAdapter } from "../gitlab/adapter.js";
import type { AssembleResult } from "../rendering/assemble.js";
import type { ServeOptions } from "../serve/server.js";
import { type PipelineDeps, type PipelineOptions, run } from "./run.js";

// Stubbed so the welcome-message test below asserts on a fixed string, independent of whether
// dist/build-info.json happens to exist when the test suite runs.
vi.mock("../version.js", () => ({
  formatVersion: vi.fn(() => "Tulip 9.9.9 (test123, built now)"),
}));

const PR: PrRef = { forge: "github", host: "github.com", repoPath: "octo/widgets", number: 42 };

const ADDED_FILE_DIFF = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..1234567",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,3 @@",
  "+export function hello() {",
  '+  return "hi";',
  "+}",
].join("\n");

const CHANGE_ID = "src/new.ts:head:1-3";

const BINARY_ONLY_DIFF = [
  "diff --git a/image.png b/image.png",
  "index 1111111..2222222 100644",
  "Binary files a/image.png and b/image.png differ",
].join("\n");

const RENAMED_WITH_CHANGES_DIFF = [
  "diff --git a/old/name.ts b/new/name.ts",
  "similarity index 80%",
  "rename from old/name.ts",
  "rename to new/name.ts",
  "index 1111111..2222222 100644",
  "--- a/old/name.ts",
  "+++ b/new/name.ts",
  "@@ -1,3 +1,3 @@",
  " unchanged",
  "-old line",
  "+new line",
  " tail",
].join("\n");

function metadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    title: "Add hello()",
    body: "Adds a greeting helper.",
    files: ["src/new.ts"],
    diff: ADDED_FILE_DIFF,
    base: { ref: "main", sha: "base-sha" },
    head: { ref: "feature", sha: "head-sha" },
    ...overrides,
  };
}

function fakeCheckout(): PrCheckout & { cleanup: ReturnType<typeof vi.fn> } {
  return {
    dir: "/tmp/tulip-checkout",
    getFileAtBase: vi.fn(async () => undefined),
    getFileAtHead: vi.fn(async () => "hello\n"),
    cleanup: vi.fn(async () => {}),
  };
}

function classificationResult(): ClassifyChangesResult {
  return {
    categories: [{ id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" }],
    assignments: new Map([[CHANGE_ID, [{ category: "c1", codeType: "production" }]]]),
    ignoredChangeIds: new Set(),
    changesById: new Map([
      [
        CHANGE_ID,
        {
          id: CHANGE_ID,
          path: "src/new.ts",
          status: "added",
          head: { range: { start: 1, end: 3 }, lines: ["+export function hello() {"] },
          excerpt: "+export function hello() {",
        },
      ],
    ]),
  };
}

function baseDeps(order: string[] = []) {
  const checkout = fakeCheckout();
  const preview: PreparedPreview = {
    publish: vi.fn(async (): Promise<PublishedPreview> => {
      order.push("preview-publish");
      return {
        commentUrl: "https://github.com/octo/widgets/pull/42#issuecomment-9",
        previewUrl: "https://github.com/octo/widgets/blob/abc/tulip-pr-42-headsha.html",
        warnings: [],
      };
    }),
  };
  const deps = {
    fetchPrMetadata: vi.fn(async () => {
      order.push("fetch");
      return metadata();
    }),
    commenter: {
      checkAuth: vi.fn(async (): Promise<void> => {
        order.push("auth");
      }),
      postComment: vi.fn(async () => "comment-url"),
    } as PrCommenter | undefined,
    previewPublisher: {
      prepare: vi.fn(async (): Promise<PreparedPreview> => {
        order.push("preview-prepare");
        return preview;
      }),
    } as PreviewPublisher | undefined,
    // The real adapter, with the network-facing parts replaced by the fakes above.
    forgeFor: (pr: PrRef): ForgeAdapter => {
      const { commenter: _, previewPublisher: __, ...adapter } = forgeFor(pr);
      return {
        ...adapter,
        fetchPrMetadata: () => deps.fetchPrMetadata(),
        ...(deps.commenter && { commenter: deps.commenter }),
        ...(deps.previewPublisher && { previewPublisher: deps.previewPublisher }),
      };
    },
    createCheckout: vi.fn(async () => {
      order.push("checkout");
      return checkout;
    }),
    materializeChangeArtifacts: vi.fn(async (): Promise<void> => {
      order.push("materialize");
    }),
    prepareWorkspace: vi.fn(async (_dir: string, _backend: AgentBackend): Promise<void> => {
      order.push("prepare-workspace");
    }),
    generateCategories: vi.fn(async (): Promise<GenerateCategoriesResult> => {
      order.push("phase1");
      return {
        categories: [
          { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        ],
        sessionId: "s1",
      };
    }),
    reviewAndAmendCategories: vi.fn(async (): Promise<CategoryReviewLoopResult> => {
      order.push("phase1-review");
      return {
        categories: [
          { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        ],
        sessionId: "s1",
      };
    }),
    splitLargeChanges: vi.fn(async ({ diff }: { diff: ParsedDiff }): Promise<ParsedDiff> => {
      order.push("split");
      return diff;
    }),
    classifyChanges: vi.fn(async () => {
      order.push("phase2");
      return classificationResult();
    }),
    explainCategories: vi.fn(async (): Promise<CategoryExplanation[]> => {
      order.push("phase3");
      return [
        {
          category: {
            id: "c1",
            name: "Greeting",
            description: "Adds hello().",
            attention: "normal",
          },
          markdown: "prose",
        },
      ];
    }),
    renderExplanations: vi.fn(async (): Promise<AssembleResult> => {
      order.push("render");
      return {
        dir: "/tmp/tulip-render",
        indexPath: "/tmp/tulip-render/index.html",
      };
    }),
    writeRunManifest: vi.fn(async (): Promise<void> => {}),
    readSharableRun: vi.fn(async () => ({
      pr: PR,
      preview: {
        page: "<html>standalone</html>",
        headSha: "head-sha",
        generatedAt: new Date("2026-10-19T14:32:00Z"),
      },
    })),
    serveForReview: vi.fn(async (): Promise<void> => {
      order.push("serve");
    }),
    openInBrowser: vi.fn(async (): Promise<void> => {}),
    logger: { info: vi.fn(), debug: vi.fn() },
  };
  return deps;
}

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    pr: PR,
    diffThreshold: 400,
    verbose: false,
    open: true,
    serve: false,
    attachPreviewAsComment: false,
    shareKeyPath: "/tmp/share-key",
    agent: "claude",
    ...overrides,
  };
}

function serveOptions(deps: ReturnType<typeof baseDeps>): ServeOptions {
  const calls = deps.serveForReview.mock.calls as unknown as [ServeOptions][];
  return calls[0]?.[0] as ServeOptions;
}

function infoLines(deps: PipelineDeps): string[] {
  const info = deps.logger?.info as ReturnType<typeof vi.fn>;
  return info.mock.calls.map((call) => String(call[0]));
}

/** The RunnerDeps object (2nd arg) a mocked phase was called with, for inspecting the threaded
 * `usage` ledger. */
function phaseRunnerDeps(fn: { mock: { calls: unknown[][] } }): {
  usage?: UsageLedger;
  agent?: Agent;
} {
  return (fn.mock.calls[0]?.[1] ?? {}) as { usage?: UsageLedger; agent?: Agent };
}

/** The RunnerDeps every LLM phase is called with. */
function expectedRunnerDeps(deps: ReturnType<typeof baseDeps>) {
  return {
    cwd: "/tmp/tulip-checkout",
    usage: expect.any(Object),
    logger: deps.logger,
    agent: expect.any(Object),
  };
}

/** A generateCategories mock that records one sonnet call per entry of `usages` (`undefined` = a
 * call that reported none) into the ledger it's handed, so run()'s end-of-run summary has
 * something to print. The double cast bridges baseDeps' zero-arg mock signature to the real
 * (input, runnerDeps) shape run() calls it with. */
function recordingGenerate(
  ...usages: (ModelTokens | undefined)[]
): ReturnType<typeof baseDeps>["generateCategories"] {
  const calls =
    usages.length > 0 ? usages : [{ input: 100, output: 20, cacheRead: 5, cacheWrite: 3 }];
  return vi.fn(async (_input: unknown, runnerDeps: { usage: UsageLedger }) => {
    for (const usage of calls) {
      runnerDeps.usage.record({ tier: "balanced", model: "sonnet" }, usage);
    }
    return {
      categories: [
        { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" as const },
      ],
      sessionId: "s1",
    };
  }) as unknown as ReturnType<typeof baseDeps>["generateCategories"];
}

describe("run", () => {
  let originalExitCode: number | string | undefined | null;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("wires all phases in order and cleans up the checkout on success", async () => {
    const order: string[] = [];
    const deps = baseDeps(order);

    await run(options(), deps);

    expect(order).toEqual([
      "fetch",
      "checkout",
      "materialize",
      "prepare-workspace",
      "phase1",
      "phase1-review",
      "split",
      "phase2",
      "phase3",
      "render",
    ]);
    expect(deps.materializeChangeArtifacts).toHaveBeenCalledWith(
      await deps.createCheckout.mock.results[0]?.value,
      expect.objectContaining({ files: expect.any(Array) }),
      ADDED_FILE_DIFF,
      { logger: deps.logger },
    );
    expect(deps.generateCategories).toHaveBeenCalledWith(
      {
        title: "Add hello()",
        description: "Adds a greeting helper.",
        files: [{ path: "src/new.ts", status: "added" }],
      },
      expectedRunnerDeps(deps),
    );
    expect(deps.reviewAndAmendCategories).toHaveBeenCalledWith(
      {
        prTitle: "Add hello()",
        prDescription: "Adds a greeting helper.",
        files: [{ path: "src/new.ts", status: "added" }],
        categories: [
          { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        ],
        generateSessionId: "s1",
      },
      expectedRunnerDeps(deps),
    );
    expect(deps.classifyChanges).toHaveBeenCalledWith(
      {
        diff: expect.anything(),
        categories: [
          { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        ],
        phase1SessionId: "s1",
      },
      expectedRunnerDeps(deps),
    );
    expect(deps.explainCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Add hello()",
        prDescription: "Adds a greeting helper.",
        diffThreshold: 400,
        baseSha: "base-sha",
        headSha: "head-sha",
        categorySets: [
          expect.objectContaining({
            category: {
              id: "c1",
              name: "Greeting",
              description: "Adds hello().",
              attention: "normal",
            },
          }),
        ],
      }),
      expectedRunnerDeps(deps),
    );
    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Add hello()",
        prDescription: "Adds a greeting helper.",
        prUrl: "https://github.com/octo/widgets/pull/42",
      }),
      expect.objectContaining({ logger: deps.logger }),
    );

    // Every phase gets the SAME ledger instance (one summary for the whole run), not its own.
    const sharedUsage = phaseRunnerDeps(deps.generateCategories).usage;
    expect(sharedUsage).toBeDefined();
    expect(phaseRunnerDeps(deps.reviewAndAmendCategories).usage).toBe(sharedUsage);
    expect(phaseRunnerDeps(deps.splitLargeChanges).usage).toBe(sharedUsage);
    expect(phaseRunnerDeps(deps.classifyChanges).usage).toBe(sharedUsage);
    expect(phaseRunnerDeps(deps.explainCategories).usage).toBe(sharedUsage);

    // Same for the agent: one per run, so a session started in one phase resumes in another.
    const sharedAgent = phaseRunnerDeps(deps.generateCategories).agent;
    expect(sharedAgent?.backend.id).toBe("claude");
    expect(phaseRunnerDeps(deps.reviewAndAmendCategories).agent).toBe(sharedAgent);
    expect(phaseRunnerDeps(deps.splitLargeChanges).agent).toBe(sharedAgent);
    expect(phaseRunnerDeps(deps.classifyChanges).agent).toBe(sharedAgent);
    expect(phaseRunnerDeps(deps.explainCategories).agent).toBe(sharedAgent);

    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the per-model token-usage summary at the end of a successful run", async () => {
    const deps = baseDeps();
    deps.generateCategories = recordingGenerate();

    await run(options(), deps);

    const summary = infoLines(deps).find((line) => line.startsWith("Token usage"));
    expect(summary).toBeDefined();
    expect(summary).toContain("sonnet");
  });

  it("prepares the workspace of the agent named by options.agent, in the checkout", async () => {
    const deps = baseDeps();

    await run(options({ agent: "codex" }), deps);

    expect(deps.prepareWorkspace).toHaveBeenCalledWith(
      "/tmp/tulip-checkout",
      expect.objectContaining({ id: "codex" }),
    );
  });

  it("says token usage wasn't reported when calls ran but none carried usage", async () => {
    const deps = baseDeps();
    deps.generateCategories = recordingGenerate(undefined);

    await run(options(), deps);

    expect(infoLines(deps)).toContain("1 claude call(s) didn't report token usage");
    expect(infoLines(deps).find((line) => line.startsWith("Token usage"))).toBeUndefined();
  });

  it("notes calls that didn't report usage under a partial token-usage summary", async () => {
    const deps = baseDeps();
    deps.generateCategories = recordingGenerate(
      { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
      undefined,
    );

    await run(options(), deps);

    const lines = infoLines(deps);
    expect(lines.find((line) => line.startsWith("Token usage"))).toBeDefined();
    expect(lines).toContain("1 claude call(s) didn't report token usage");
  });

  it("still prints the token-usage summary after a mid-run failure", async () => {
    const deps = baseDeps();
    deps.generateCategories = recordingGenerate();
    deps.classifyChanges = vi.fn(async () => {
      throw new Error("boom");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(infoLines(deps).find((line) => line.startsWith("Token usage"))).toBeDefined();
  });

  it("logs the welcome message and what it will process, before fetching", async () => {
    const deps = baseDeps();

    await run(options(), deps);

    const lines = infoLines(deps);
    expect(lines[0]).toBe("Tulip 9.9.9 (test123, built now)");
    expect(lines[1]).toBe("Processing PR https://github.com/octo/widgets/pull/42 with claude");
    expect(lines[2]).toBe("fetching octo/widgets#42...");
  });

  it("exits cleanly with no LLM calls when the PR has no classifiable changes", async () => {
    const deps = baseDeps();
    deps.fetchPrMetadata = vi.fn(async () =>
      metadata({ diff: BINARY_ONLY_DIFF, files: ["image.png"] }),
    );

    await run(options(), deps);

    expect(process.exitCode).toBeUndefined();
    expect(deps.createCheckout).not.toHaveBeenCalled();
    expect(deps.materializeChangeArtifacts).not.toHaveBeenCalled();
    expect(deps.generateCategories).not.toHaveBeenCalled();
    expect(deps.classifyChanges).not.toHaveBeenCalled();
    expect(deps.explainCategories).not.toHaveBeenCalled();
    expect(deps.renderExplanations).not.toHaveBeenCalled();
    const lines = infoLines(deps);
    expect(lines.some((line) => line.includes("nothing to review"))).toBe(true);
  });

  it("passes a renamed-file path map to rendering, built from the parsed diff", async () => {
    const deps = baseDeps();
    deps.fetchPrMetadata = vi.fn(async () =>
      metadata({ diff: RENAMED_WITH_CHANGES_DIFF, files: ["new/name.ts"] }),
    );

    await run(options(), deps);

    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({
        renamedFrom: new Map([["new/name.ts", "old/name.ts"]]),
      }),
      expect.anything(),
    );
  });

  it("logs the generated category names and phase progress", async () => {
    const deps = baseDeps();

    await run(options(), deps);

    const lines = infoLines(deps);
    expect(lines).toContainEqual(
      expect.stringMatching(/^generated 1 categories in \d+s: Greeting$/),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/^categories after review \(\d+s\): Greeting$/),
    );
    expect(lines.some((line) => line.includes("phase 1"))).toBe(true);
    expect(lines.some((line) => line.includes("phase 2"))).toBe(true);
    expect(lines).toContain("phase 3: generating explanations for 1 categories...");
    expect(lines).toContainEqual(
      expect.stringMatching(/^generated explanations for 1 categories in \d+s$/),
    );
    expect(lines.some((line) => line.includes("preparing output page"))).toBe(true);
  });

  it("summarizes classification: total, elapsed, per-category counts and the ignored count", async () => {
    const deps = baseDeps();
    const first = [...classificationResult().changesById.values()][0] as ClassifiableChange;
    const second = { ...first, id: "second" };
    const third = { ...first, id: "third" };
    deps.classifyChanges = vi.fn(async () => ({
      categories: [
        { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        { id: "c2", name: "Tests", description: "Covers hello().", attention: "skim" },
      ],
      assignments: new Map([
        [CHANGE_ID, [{ category: "c1", codeType: "production" as const }]],
        [
          "second",
          [
            { category: "c1", codeType: "production" as const },
            { category: "c2", codeType: "test" as const },
          ],
        ],
      ]),
      ignoredChangeIds: new Set(["third"]),
      changesById: new Map([
        [CHANGE_ID, first],
        ["second", second],
        ["third", third],
      ]),
    }));

    await run(options(), deps);

    expect(infoLines(deps)).toContainEqual(
      expect.stringMatching(
        /^classified 3 changes in \d+s: Greeting \(2\), Tests \(1\); 1 ignored$/,
      ),
    );
  });

  it("omits the ignored count from the classification summary when nothing was ignored", async () => {
    const deps = baseDeps();

    await run(options(), deps);

    expect(infoLines(deps)).toContainEqual(
      expect.stringMatching(/^classified 1 changes in \d+s: Greeting \(1\)$/),
    );
  });

  it("warns when PrMetadata.files and the parsed diff disagree", async () => {
    const deps = baseDeps();
    deps.fetchPrMetadata = vi.fn(async () => metadata({ files: ["src/other.ts"] }));

    await run(options(), deps);

    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("warning") && line.includes("src/other.ts") && line.includes("src/new.ts"),
      ),
    ).toBe(true);
  });

  it("does not warn when PrMetadata.files and the parsed diff agree", async () => {
    const deps = baseDeps();

    await run(options(), deps);

    const lines = infoLines(deps);
    expect(lines.some((line) => line.includes("warning"))).toBe(false);
  });

  it("on a fetch failure, reports both causes, sets exit code 1, and never creates a checkout", async () => {
    const deps = baseDeps();
    deps.fetchPrMetadata = vi.fn(async () => {
      throw new Error(
        "Failed to fetch PR octo/widgets#42: gh CLI failed (not found); HTTP fallback failed (network error)",
      );
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.createCheckout).not.toHaveBeenCalled();
    const lines = infoLines(deps);
    expect(
      lines.some((line) => line.includes("gh CLI failed") && line.includes("HTTP fallback failed")),
    ).toBe(true);
    expect(lines.every((line) => !line.includes("at Object") && !line.includes(".ts:"))).toBe(true);
  });

  it("reports a missing agent binary with its own actionable message, unwrapped", async () => {
    const deps = baseDeps();
    deps.generateCategories = vi.fn(async () => {
      throw new AgentBinaryMissingError("claude", "install Claude Code");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.reviewAndAmendCategories).not.toHaveBeenCalled();
    expect(deps.classifyChanges).not.toHaveBeenCalled();
    expect(deps.explainCategories).not.toHaveBeenCalled();
    expect(deps.renderExplanations).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) => line === new AgentBinaryMissingError("claude", "install Claude Code").message,
      ),
    ).toBe(true);
  });

  it("reports an AgentOutputError from phase 1, naming the phase, and cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.generateCategories = vi.fn(async () => {
      throw new AgentOutputError("the agent returned an empty category list");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("phase 1 (generating categories) failed") &&
          line.includes("the agent returned an empty category list"),
      ),
    ).toBe(true);
  });

  it("reports an AgentOutputError from the category review stage, naming the phase, and cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.reviewAndAmendCategories = vi.fn(async () => {
      throw new AgentOutputError("the agent returned an empty amended category list");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.classifyChanges).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("phase 1 (reviewing categories) failed") &&
          line.includes("the agent returned an empty amended category list"),
      ),
    ).toBe(true);
  });

  it("classifies against the review's amended categories and session, not phase 1's originals", async () => {
    const deps = baseDeps();
    deps.reviewAndAmendCategories = vi.fn(async () => ({
      categories: [
        { id: "c1", name: "Greeting (amended)", description: "Amended.", attention: "close" },
      ],
      sessionId: "s1-amended",
    }));

    await run(options(), deps);

    expect(deps.classifyChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: [
          { id: "c1", name: "Greeting (amended)", description: "Amended.", attention: "close" },
        ],
        phase1SessionId: "s1-amended",
      }),
      expectedRunnerDeps(deps),
    );
  });

  it("splits large changes between category review and classification, then classifies the split diff", async () => {
    const deps = baseDeps();
    const splitDiff: ParsedDiff = { files: [] };
    deps.splitLargeChanges = vi.fn(async (): Promise<ParsedDiff> => splitDiff);

    await run(options(), deps);

    expect(deps.splitLargeChanges).toHaveBeenCalledWith(
      {
        diff: expect.objectContaining({ files: expect.any(Array) }),
        categories: [
          { id: "c1", name: "Greeting", description: "Adds hello().", attention: "normal" },
        ],
      },
      expectedRunnerDeps(deps),
    );
    // Only classification gets the split diff.
    expect(deps.classifyChanges).toHaveBeenCalledWith(
      expect.objectContaining({ diff: splitDiff }),
      expectedRunnerDeps(deps),
    );
  });

  it("reports an IncompleteCoverageError from phase 2, naming the phase and the uncovered changes", async () => {
    const deps = baseDeps();
    const uncovered = [
      {
        id: CHANGE_ID,
        path: "src/new.ts",
        status: "added" as const,
        side: "head" as const,
        range: { start: 1, end: 3 },
        excerpt: "+export function hello() {",
        lines: ["+export function hello() {"],
      },
    ];
    deps.classifyChanges = vi.fn(async () => {
      throw new IncompleteCoverageError(uncovered);
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.explainCategories).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("phase 2 (classifying changes) failed") && line.includes("src/new.ts"),
      ),
    ).toBe(true);
  });

  it("reports a SnippetCoverageError from phase 3, naming the phase and the uncovered changes", async () => {
    const deps = baseDeps();
    const missing = [
      {
        id: CHANGE_ID,
        path: "src/new.ts",
        status: "added" as const,
        side: "head" as const,
        range: { start: 1, end: 3 },
        excerpt: "+export function hello() {",
        lines: ["+export function hello() {"],
      },
    ];
    deps.explainCategories = vi.fn(async () => {
      throw new SnippetCoverageError(missing);
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.renderExplanations).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("phase 3 (generating explanations) failed") && line.includes("src/new.ts"),
      ),
    ).toBe(true);
  });

  it("on a createCheckout failure, names the phase, sets exit code 1, and never calls cleanup", async () => {
    const deps = baseDeps();
    deps.createCheckout = vi.fn(async () => {
      throw new Error("fatal: could not fetch head sha");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.generateCategories).not.toHaveBeenCalled();
    expect(deps.classifyChanges).not.toHaveBeenCalled();
    expect(deps.explainCategories).not.toHaveBeenCalled();
    expect(deps.renderExplanations).not.toHaveBeenCalled();
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("creating checkout failed") &&
          line.includes("fatal: could not fetch head sha"),
      ),
    ).toBe(true);
  });

  it("on a materializeChangeArtifacts failure, names the phase, sets exit code 1, and still cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.materializeChangeArtifacts = vi.fn(async (): Promise<void> => {
      throw new Error("ENOSPC: no space left on device");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.generateCategories).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("materializing change artifacts failed") &&
          line.includes("ENOSPC: no space left on device"),
      ),
    ).toBe(true);
  });

  it("on a prepareWorkspace failure, names the phase, sets exit code 1, and still cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.prepareWorkspace = vi.fn(async (): Promise<void> => {
      throw new Error("EACCES: permission denied");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.generateCategories).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("preparing agent workspace failed") &&
          line.includes("EACCES: permission denied"),
      ),
    ).toBe(true);
  });

  it("on a renderExplanations failure, names the phase and still cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.renderExplanations = vi.fn(async () => {
      throw new Error("ENOSPC: no space left on device");
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) => line.includes("rendering failed") && line.includes("no space left on device"),
      ),
    ).toBe(true);
  });

  it("on a checkout cleanup failure, logs a warning instead of letting it escape", async () => {
    const deps = baseDeps();
    const checkout = fakeCheckout();
    checkout.cleanup.mockRejectedValueOnce(new Error("EBUSY: resource busy"));
    deps.createCheckout = vi.fn(async () => checkout);

    await expect(run(options(), deps)).resolves.toBeUndefined();

    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
    const lines = infoLines(deps);
    expect(
      lines.some(
        (line) =>
          line.includes("warning") &&
          line.includes("clean up checkout") &&
          line.includes("EBUSY: resource busy"),
      ),
    ).toBe(true);
  });

  it("opens the rendered page in the browser after rendering succeeds", async () => {
    const deps = baseDeps();

    await run(options({ open: true }), deps);

    expect(deps.openInBrowser).toHaveBeenCalledTimes(1);
    expect(deps.openInBrowser).toHaveBeenCalledWith("/tmp/tulip-render/index.html");
  });

  it("does not open the browser when open is false (--no-open)", async () => {
    const deps = baseDeps();

    await run(options({ open: false }), deps);

    expect(deps.openInBrowser).not.toHaveBeenCalled();
  });

  it("does not open the browser when rendering fails", async () => {
    const deps = baseDeps();
    deps.renderExplanations = vi.fn(async () => {
      throw new Error("ENOSPC: no space left on device");
    });

    await run(options({ open: true }), deps);

    expect(deps.openInBrowser).not.toHaveBeenCalled();
  });

  it("logs a debug note and does not fail the run when openInBrowser fails", async () => {
    const deps = baseDeps();
    deps.openInBrowser = vi.fn(async (): Promise<void> => {
      throw new Error("spawn open ENOENT");
    });

    await expect(run(options({ open: true }), deps)).resolves.toBeUndefined();

    expect(process.exitCode).toBeUndefined();
    const debug = deps.logger?.debug as ReturnType<typeof vi.fn>;
    const debugLines = debug.mock.calls.map((call) => String(call[0]));
    expect(
      debugLines.some((line) => line.includes("auto-open") && line.includes("spawn open ENOENT")),
    ).toBe(true);
  });

  it("in serve mode, preflights auth before fetching, renders with serve, and serves the dir", async () => {
    const order: string[] = [];
    const deps = baseDeps(order);

    await run(options({ serve: true }), deps);

    const commenter = deps.commenter;
    expect(commenter?.checkAuth).toHaveBeenCalledWith(PR.host);
    expect(order.indexOf("auth")).toBeLessThan(order.indexOf("fetch"));
    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({ serve: true }),
      expect.anything(),
    );
    expect(deps.serveForReview).toHaveBeenCalledTimes(1);
    expect(deps.serveForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: "/tmp/tulip-render",
        prUrl: "https://github.com/octo/widgets/pull/42",
        categoryNames: ["Greeting"],
        postComment: commenter?.postComment,
        open: true,
        logger: deps.logger,
        openInBrowser: deps.openInBrowser,
      }),
    );
    // Serve mode opens the http:// URL via the server, never the index file directly.
    expect(deps.openInBrowser).not.toHaveBeenCalledWith("/tmp/tulip-render/index.html");
  });

  it("in serve mode, a failed auth preflight aborts before fetching and never serves", async () => {
    const deps = baseDeps();
    deps.commenter = {
      checkAuth: vi.fn(async () => {
        throw new Error("gh is not authenticated for github.com; run `gh auth login`");
      }),
      postComment: vi.fn(async () => "comment-url"),
    };

    await run(options({ serve: true }), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.fetchPrMetadata).not.toHaveBeenCalled();
    expect(deps.serveForReview).not.toHaveBeenCalled();
    const lines = infoLines(deps);
    expect(lines.some((line) => line.includes("gh is not authenticated"))).toBe(true);
  });

  it("without serve, opens the index file and never checks auth or serves", async () => {
    const deps = baseDeps();

    await run(options({ serve: false }), deps);

    expect(deps.openInBrowser).toHaveBeenCalledWith("/tmp/tulip-render/index.html");
    expect(deps.serveForReview).not.toHaveBeenCalled();
    expect(deps.commenter?.checkAuth).not.toHaveBeenCalled();
  });

  it("in serve mode, fails before fetching when the forge can't post comments", async () => {
    const deps = baseDeps();
    deps.commenter = undefined;
    const pr: PrRef = { forge: "gitlab", host: "gitlab.com", repoPath: "group/project", number: 7 };

    await run(options({ pr, serve: true }), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.fetchPrMetadata).not.toHaveBeenCalled();
    expect(deps.serveForReview).not.toHaveBeenCalled();
    expect(infoLines(deps)).toContain("--serve isn't supported for gitlab URLs");
  });

  it("with a preview, prepares it before fetching and shares the single-file page", async () => {
    const order: string[] = [];
    const deps = baseDeps(order);

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(process.exitCode).toBeUndefined();
    expect(order.slice(0, 2)).toEqual(["preview-prepare", "fetch"]);
    expect(deps.previewPublisher?.prepare).toHaveBeenCalledWith(PR);
    expect(deps.writeRunManifest).toHaveBeenCalledWith(
      "/tmp/tulip-render",
      {
        prUrl: "https://github.com/octo/widgets/pull/42",
        headSha: "head-sha",
        generatedAt: expect.any(Date),
      },
      "/tmp/share-key",
    );
    expect(deps.readSharableRun).toHaveBeenCalledWith("/tmp/tulip-render", "/tmp/share-key");
    const prepared = await (deps.previewPublisher as PreviewPublisher).prepare(PR);
    expect(prepared.publish).toHaveBeenCalledWith(
      {
        page: "<html>standalone</html>",
        headSha: "head-sha",
        generatedAt: new Date("2026-10-19T14:32:00Z"),
      },
      expect.any(AbortSignal),
    );
    expect(infoLines(deps)).toContain(
      "preview shared: https://github.com/octo/widgets/pull/42#issuecomment-9",
    );
  });

  it("with a preview, logs the publisher's notice", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    const prepared = await publisher.prepare(PR);
    publisher.prepare = vi.fn(async () => ({ ...prepared, notice: "the preview goes to a fork" }));

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(infoLines(deps)).toContain("the preview goes to a fork");
  });

  it("with a preview, opens the page before sharing it", async () => {
    const order: string[] = [];
    const deps = baseDeps(order);
    deps.openInBrowser = vi.fn(async () => {
      order.push("open");
    });

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(order.indexOf("open")).toBeLessThan(order.indexOf("preview-publish"));
  });

  it("with a preview and serve mode, a failed share retried from the page doesn't fail the run", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    let attempts = 0;
    publisher.prepare = vi.fn(async () => ({
      publish: vi.fn(async (): Promise<PublishedPreview> => {
        attempts++;
        if (attempts === 1) {
          throw new Error("transient");
        }
        return { commentUrl: "c", previewUrl: "p", warnings: [] };
      }),
    }));
    deps.serveForReview.mockImplementation(async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await (args[0] as ServeOptions).share?.();
    });

    await run(options({ attachPreviewAsComment: true, serve: true }), deps);

    expect(attempts).toBe(2);
    expect(process.exitCode).toBeUndefined();
  });

  it("with a preview and serve mode, shares alongside serving, and gives the server the same share", async () => {
    const order: string[] = [];
    const deps = baseDeps(order);

    await run(options({ attachPreviewAsComment: true, serve: true }), deps);

    const share = serveOptions(deps).share;
    expect(share).toBeDefined();
    await share?.();
    const prepared = await (deps.previewPublisher as PreviewPublisher).prepare(PR);
    expect(prepared.publish).toHaveBeenCalledTimes(1);
  });

  it("in serve mode alone, prepares the preview only when the page asks to share", async () => {
    const deps = baseDeps();

    await run(options({ serve: true }), deps);

    expect(deps.previewPublisher?.prepare).not.toHaveBeenCalled();
    const commentUrl = await serveOptions(deps).share?.();
    expect(deps.previewPublisher?.prepare).toHaveBeenCalledWith(PR);
    expect(commentUrl).toBe("https://github.com/octo/widgets/pull/42#issuecomment-9");
  });

  it("without sharing, prepares nothing and says how to share later", async () => {
    const deps = baseDeps();

    await run(options(), deps);

    expect(deps.previewPublisher?.prepare).not.toHaveBeenCalled();
    expect(infoLines(deps)).toContain(
      "to share it on the PR later: tulip share /tmp/tulip-render (a temp dir the OS removes eventually)",
    );
  });

  it("doesn't suggest sharing for a forge that can't", async () => {
    const deps = baseDeps();
    deps.previewPublisher = undefined;
    const pr: PrRef = { forge: "gitlab", host: "gitlab.com", repoPath: "group/project", number: 7 };

    await run(options({ pr }), deps);

    expect(infoLines(deps).some((line) => line.includes("tulip share"))).toBe(false);
  });

  it("with a preview, fails before fetching when the forge can't share", async () => {
    const deps = baseDeps();
    deps.previewPublisher = undefined;
    const pr: PrRef = { forge: "gitlab", host: "gitlab.com", repoPath: "group/project", number: 7 };

    await run(options({ pr, attachPreviewAsComment: true }), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.fetchPrMetadata).not.toHaveBeenCalled();
    expect(infoLines(deps)).toContain(
      "--attach-preview-as-comment isn't supported for gitlab URLs",
    );
  });

  it("with a preview, a failed preparation aborts before fetching", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    publisher.prepare = vi.fn(async () => {
      throw new Error("gh is not authenticated for github.com");
    });

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.fetchPrMetadata).not.toHaveBeenCalled();
    expect(infoLines(deps)).toContain(
      "preparing the preview failed: gh is not authenticated for github.com",
    );
  });

  it("with a preview, stops the share on Ctrl+C, still cleans up, and stops listening after", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    let stopSignal: AbortSignal | undefined;
    publisher.prepare = vi.fn(async () => ({
      publish: vi.fn(async (_preview: unknown, signal?: AbortSignal) => {
        stopSignal = signal;
        process.emit("SIGINT");
        signal?.throwIfAborted();
        return { commentUrl: "c", previewUrl: "p", warnings: [] };
      }),
    }));
    const listenersBefore = process.listenerCount("SIGINT");

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(stopSignal?.aborted).toBe(true);
    expect(infoLines(deps)).toEqual(
      expect.arrayContaining([
        "stopping the preview share...",
        "retry without re-running the analysis: tulip share /tmp/tulip-render",
      ]),
    );
    expect(process.exitCode).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
  });

  it("with a preview and serve mode, stops the share once the server is stopped", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    let stopSignal: AbortSignal | undefined;
    publisher.prepare = vi.fn(async () => ({
      publish: vi.fn(
        (_preview: unknown, signal?: AbortSignal) =>
          new Promise<PublishedPreview>((_resolve, reject) => {
            stopSignal = signal;
            if (signal?.aborted) {
              reject(signal.reason);
            }
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    }));

    await run(options({ attachPreviewAsComment: true, serve: true }), deps);

    expect(stopSignal?.aborted).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("renders the Share button only in serve mode, for a forge that can share", async () => {
    const deps = baseDeps();

    await run(options({ serve: true }), deps);

    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({ serve: true, share: true }),
      expect.anything(),
    );
  });

  it("with a preview, a failed share keeps the run's results and says how to retry", async () => {
    const deps = baseDeps();
    const publisher = deps.previewPublisher as PreviewPublisher;
    publisher.prepare = vi.fn(async () => ({
      publish: vi.fn(async (): Promise<PublishedPreview> => {
        throw new Error("HTTP 422");
      }),
    }));

    await run(options({ attachPreviewAsComment: true }), deps);

    expect(process.exitCode).toBe(1);
    expect(infoLines(deps)).toEqual(
      expect.arrayContaining([
        "sharing the preview failed: HTTP 422",
        "retry without re-running the analysis: tulip share /tmp/tulip-render",
      ]),
    );
    expect(deps.openInBrowser).toHaveBeenCalledWith("/tmp/tulip-render/index.html");
  });

  it("uses the PR's host in the serve-mode URL, not a hardcoded github.com", async () => {
    const deps = baseDeps();
    const pr: PrRef = {
      forge: "github",
      host: "git.xyz.com",
      repoPath: "octo/widgets",
      number: 42,
    };

    await run(options({ pr, serve: true }), deps);

    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({ prUrl: "https://git.xyz.com/octo/widgets/pull/42" }),
      expect.anything(),
    );
    expect(deps.serveForReview).toHaveBeenCalledWith(
      expect.objectContaining({ prUrl: "https://git.xyz.com/octo/widgets/pull/42" }),
    );
  });

  it("names a GitLab merge request by its MR URL and label", async () => {
    const deps = baseDeps();
    const pr: PrRef = {
      forge: "gitlab",
      host: "git.example.com",
      repoPath: "group/project",
      number: 7,
    };

    await run(options({ pr }), deps);

    const lines = infoLines(deps);
    expect(lines[1]).toBe(
      "Processing PR https://git.example.com/group/project/-/merge_requests/7 with claude",
    );
    expect(lines[2]).toBe("fetching group/project!7...");
    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({
        prUrl: "https://git.example.com/group/project/-/merge_requests/7",
      }),
      expect.anything(),
    );
  });

  it("checks out a GitLab merge request with GitLab's git credentials", async () => {
    const deps = baseDeps();
    const pr: PrRef = { forge: "gitlab", host: "gitlab.com", repoPath: "group/project", number: 7 };

    await run(options({ pr }), deps);

    expect(deps.createCheckout).toHaveBeenCalledWith(
      pr,
      expect.anything(),
      gitlabAdapter.checkoutAuth,
    );
  });
});
