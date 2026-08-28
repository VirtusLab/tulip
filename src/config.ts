/**
 * Central home for tulip's hand-tuned constants: which model each phase uses, process timeouts,
 * and retry/cap/size limits. Grouped by concern; import the whole `config` object and read off
 * `config.<group>.<name>` rather than importing individual fields, so a value's usage stays
 * traceable with a single `git grep config\.`.
 *
 * Leaf module: must not import from anywhere else in src, so every other module can safely
 * depend on it without risking a cycle.
 */
export const config = {
  /** Fixed CLI flags applied to every `claude` invocation, regardless of phase. */
  claude: {
    /** `--allowedTools` entries granting read-only git access via Bash, in addition to a
     * session's default Read/Grep/Glob — so it can inspect history/diffs/blame beyond a single
     * file without a blanket (and, headless, unapprovable) Bash grant — see src/claude/runner.ts.
     * Syntax per `claude --help`'s own `--allowedTools` example ("Bash(git *) Edit"): a
     * `Tool(prefix)` specifier, one per argv token. */
    allowedTools: ["Bash(git diff:*)", "Bash(git show:*)", "Bash(git log:*)", "Bash(git blame:*)"],
  },

  /** `claude --model` alias used to start each phase's fresh session. */
  models: {
    /** Phase 1: proposes the PR's category list — see src/categories/generate.ts. */
    categoryGeneration: "sonnet",
    /** Phase 2: classifies each change into a category — see src/classification/classify.ts. */
    classification: "haiku",
    /** Phase 3: writes a category's explanation — see src/explanations/explain.ts. */
    explanation: "opus",
    /** Phase 3: reviews/critiques an explanation draft — see src/explanations/review.ts. */
    review: "sonnet",
  },

  /** Per-call ceilings for spawned subprocesses. Generous — high enough that they should only
   * ever fire on a genuinely hung process, not a slow-but-working one. */
  timeouts: {
    /** Single `claude -p` invocation — see src/claude/exec.ts. */
    claudeProcessMs: 10 * 60 * 1000,
    /** Single `gh`/`git` subcommand — see src/github/exec.ts. */
    githubCommandMs: 2 * 60 * 1000,
    /** Single GitHub REST API request (the `gh`-unavailable fallback) — see src/github/pr-fetcher.ts. */
    githubFetchMs: 60 * 1000,
  },

  /** Retry/cap counts and size limits that bound otherwise-unbounded loops or prompt sizes. */
  limits: {
    /** Max `claude` processes running at once, global to the tool (per spec) — see
     * src/claude/concurrency.ts. */
    maxConcurrentClaudeProcesses: 3,
    /** Default `--diff-threshold`: max diff lines fed verbatim to the explaining LLM before
     * falling back to a file+line-range reference — see src/cli/args.ts. */
    defaultDiffThreshold: 400,
    /** Explanation review rounds before keeping the latest version as-is (spec: "up to 3 times")
     * — see src/explanations/review.ts. */
    maxReviewRounds: 3,
    /** New categories the escape hatch will accept per run before auto-rejecting further
     * proposals — see src/classification/escape-hatch.ts. */
    maxAcceptedNewCategories: 5,
    /** Classification coverage-repair attempts before giving up on the remaining changes — see
     * src/classification/coverage.ts. */
    maxCoverageRepairAttempts: 3,
    /** Explanation snippet-coverage amend attempts before giving up on the remaining changes —
     * see src/explanations/coverage.ts. */
    maxSnippetCoverageAttempts: 3,
    /** Max changes per classification batch — see src/classification/batch.ts. */
    maxBatchSize: 20,
    /** Max total excerpt chars per classification batch, regardless of change count — see
     * src/classification/batch.ts. */
    maxBatchExcerptChars: 20_000,
    /** Diff excerpts longer than this are truncated (with a marker) before going into a
     * classification prompt — see src/classification/excerpt.ts. */
    maxExcerptChars: 2000,
    /** Per-side file size above which a referenced file's content isn't embedded for
     * client-side context expansion — see src/rendering/file-diffs.ts. */
    embedSizeCapBytes: 200 * 1024,
    /** Safety net against an unbounded pagination loop when fetching a PR's file list over the
     * GitHub REST API — see src/github/pr-fetcher.ts. */
    maxPrFilesSafetyNet: 3000,
    /** Commit depth fetched for each of the checkout's base/head revisions — enough for `git
     * log`/`git blame` in a claude session to see real history, not just the tip commit — see
     * src/github/checkout.ts. */
    checkoutFetchDepth: 50,
  },
} as const;
