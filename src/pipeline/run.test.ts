import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateCategoriesResult } from "../categories/generate.js";
import { IncompleteCoverageError } from "../classification/coverage.js";
import type { ClassifyChangesResult } from "../classification/orchestrate.js";
import { ClaudeBinaryMissingError, ClaudeOutputError } from "../claude/errors.js";
import { SnippetCoverageError } from "../explanations/coverage.js";
import type { CategoryExplanation } from "../explanations/types.js";
import type { PrCheckout } from "../github/checkout.js";
import type { PrMetadata } from "../github/pr-fetcher.js";
import type { PrRef } from "../github/pr-url.js";
import type { AssembleResult } from "../rendering/assemble.js";
import { type PipelineDeps, type PipelineOptions, run } from "./run.js";

const PR: PrRef = { owner: "octo", repo: "widgets", number: 42 };

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
    categories: [{ name: "Greeting", description: "Adds hello()." }],
    assignments: new Map([[CHANGE_ID, [{ category: "Greeting", codeType: "production" }]]]),
    ignoredChangeIds: new Set(),
    changesById: new Map([
      [
        CHANGE_ID,
        {
          id: CHANGE_ID,
          path: "src/new.ts",
          status: "added",
          side: "head",
          range: { start: 1, end: 3 },
          excerpt: "+export function hello() {",
        },
      ],
    ]),
  };
}

function baseDeps(order: string[] = []) {
  const checkout = fakeCheckout();
  return {
    fetchPrMetadata: vi.fn(async () => {
      order.push("fetch");
      return metadata();
    }),
    createCheckout: vi.fn(async () => {
      order.push("checkout");
      return checkout;
    }),
    generateCategories: vi.fn(async (): Promise<GenerateCategoriesResult> => {
      order.push("phase1");
      return { categories: [{ name: "Greeting", description: "Adds hello()." }], sessionId: "s1" };
    }),
    classifyChanges: vi.fn(async () => {
      order.push("phase2");
      return classificationResult();
    }),
    explainCategories: vi.fn(async (): Promise<CategoryExplanation[]> => {
      order.push("phase3");
      return [{ category: { name: "Greeting", description: "Adds hello()." }, markdown: "prose" }];
    }),
    renderExplanations: vi.fn(async (): Promise<AssembleResult> => {
      order.push("render");
      return { dir: "/tmp/tulip-render", indexPath: "/tmp/tulip-render/index.html" };
    }),
    logger: { info: vi.fn(), debug: vi.fn() },
  };
}

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return { pr: PR, diffThreshold: 400, verbose: false, ...overrides };
}

function infoLines(deps: PipelineDeps): string[] {
  const info = deps.logger?.info as ReturnType<typeof vi.fn>;
  return info.mock.calls.map((call) => String(call[0]));
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

    expect(order).toEqual(["fetch", "checkout", "phase1", "phase2", "phase3", "render"]);
    expect(deps.generateCategories).toHaveBeenCalledWith(
      {
        title: "Add hello()",
        description: "Adds a greeting helper.",
        files: [{ path: "src/new.ts", status: "added" }],
      },
      { cwd: "/tmp/tulip-checkout" },
    );
    expect(deps.classifyChanges).toHaveBeenCalledWith(
      {
        diff: expect.anything(),
        categories: [{ name: "Greeting", description: "Adds hello()." }],
        phase1SessionId: "s1",
      },
      { cwd: "/tmp/tulip-checkout" },
    );
    expect(deps.explainCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Add hello()",
        prDescription: "Adds a greeting helper.",
        diffThreshold: 400,
        categorySets: [
          expect.objectContaining({
            category: { name: "Greeting", description: "Adds hello()." },
          }),
        ],
      }),
      expect.objectContaining({ logger: deps.logger, cwd: "/tmp/tulip-checkout" }),
    );
    expect(deps.renderExplanations).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Add hello()",
        prDescription: "Adds a greeting helper.",
        prUrl: "https://github.com/octo/widgets/pull/42",
      }),
      expect.objectContaining({ logger: deps.logger }),
    );

    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("exits cleanly with no LLM calls when the PR has no classifiable changes", async () => {
    const deps = baseDeps();
    deps.fetchPrMetadata = vi.fn(async () =>
      metadata({ diff: BINARY_ONLY_DIFF, files: ["image.png"] }),
    );

    await run(options(), deps);

    expect(process.exitCode).toBeUndefined();
    expect(deps.createCheckout).not.toHaveBeenCalled();
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
    expect(lines.some((line) => line.includes("generated 1 categories: Greeting"))).toBe(true);
    expect(lines.some((line) => line.includes("phase 1"))).toBe(true);
    expect(lines.some((line) => line.includes("phase 2"))).toBe(true);
    expect(lines.some((line) => line.includes("phase 3"))).toBe(true);
    expect(lines.some((line) => line.includes("preparing output page"))).toBe(true);
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

  it("reports a missing claude binary with its own actionable message, unwrapped", async () => {
    const deps = baseDeps();
    deps.generateCategories = vi.fn(async () => {
      throw new ClaudeBinaryMissingError();
    });

    await run(options(), deps);

    expect(process.exitCode).toBe(1);
    expect(deps.classifyChanges).not.toHaveBeenCalled();
    expect(deps.explainCategories).not.toHaveBeenCalled();
    expect(deps.renderExplanations).not.toHaveBeenCalled();
    const checkout = await deps.createCheckout.mock.results[0]?.value;
    expect(checkout.cleanup).toHaveBeenCalledTimes(1);
    const lines = infoLines(deps);
    expect(lines.some((line) => line === new ClaudeBinaryMissingError().message)).toBe(true);
  });

  it("reports a ClaudeOutputError from phase 1, naming the phase, and cleans up the checkout", async () => {
    const deps = baseDeps();
    deps.generateCategories = vi.fn(async () => {
      throw new ClaudeOutputError("claude returned an empty category list");
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
          line.includes("claude returned an empty category list"),
      ),
    ).toBe(true);
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
});
