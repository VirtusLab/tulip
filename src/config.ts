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
  /** Per-agent CLI settings (docs/adr/0027). Each agent maps the generic model tiers used by
   * `models` below to its own `--model` ids — see src/agent/agent.ts. */
  agents: {
    claude: {
      bin: "claude",
      models: { fast: "haiku", balanced: "sonnet", strong: "opus" },
      /** `--allowedTools` entries, e.g. `"Bash(git log:*)"` (syntax per `claude --help`'s own
       * `--allowedTools` example, "Bash(git *) Edit": a `Tool(prefix)` specifier, one per argv
       * token). Deliberately empty: a security review found that any `Bash(git ...)` grant lets
       * the model run e.g. `git log --output=<path>`, writing attacker-controlled content (a
       * malicious PR's own commit message) to an arbitrary path — `claude`'s prefix-based
       * `--allowedTools`/`--disallowedTools` matching can't block a flag that may appear at any
       * argv position (see docs/adr/0002). Sessions instead rely on their default Read/Grep/Glob
       * access to the checked-out working tree (see src/checkout/checkout.ts) — no Bash grant, no
       * vector. Kept as a list (not removed) so it stays the one place to configure this, and
       * `planSpawn` (src/agent/backends/claude.ts) omits `--allowedTools` entirely when it's
       * empty. */
      allowedTools: [],
    },
    "cursor-anthropic": {
      bin: "agent",
      models: {
        fast: "claude-haiku-5-5-medium",
        balanced: "claude-sonnet-5-5-medium",
        strong: "claude-opus-5-5-high",
      },
    },
    /** `xhigh` is not used: in a test run it was still reading the checkout after 9 minutes. */
    "cursor-grok": {
      bin: "agent",
      models: {
        fast: "grok-4.7-low",
        balanced: "grok-4.7-medium",
        strong: "grok-4.7-high",
      },
    },
    /** Model choice: docs/adr/0028. */
    codex: {
      bin: "codex",
      models: {
        fast: "gpt-6-luna",
        balanced: "gpt-6-sol",
        strong: "gpt-6.1-sol",
      },
    },
  },

  /** Model tier used to start each phase's fresh session; each agent maps it to a concrete
   * model via `agents.<id>.models`. */
  models: {
    /** Phase 1: proposes the PR's category list — see src/categories/generate.ts. */
    categoryGeneration: "balanced",
    /** Phase 2: classifies each change into a category — see src/classification/classify.ts. */
    classification: "fast",
    /** Proposes where to split large changes into per-concern sub-changes (docs/adr/0016) — see
     * src/splitting. */
    changeSplitting: "balanced",
    /** Phase 3: writes a category's explanation — see src/explanations/explain.ts. */
    explanation: "strong",
    /** Phase 3: reviews/critiques an explanation draft — see src/explanations/review.ts. */
    review: "balanced",
  },

  /** Per-call ceilings for spawned subprocesses. Generous — high enough that they should only
   * ever fire on a genuinely hung process, not a slow-but-working one. */
  timeouts: {
    /** Single agent CLI invocation — see src/agent/exec.ts. */
    agentProcessMs: 10 * 60 * 1000,
    /** Single `gh`/`git` subcommand — see src/process/exec.ts. */
    forgeCommandMs: 2 * 60 * 1000,
    /** Single forge REST API request — see src/forge/http.ts. */
    forgeApiFetchMs: 60 * 1000,
  },

  /** Retry/cap counts and size limits that bound otherwise-unbounded loops or prompt sizes. */
  limits: {
    /** Max agent CLI processes running at once, global to the tool (per spec) — see
     * src/agent/concurrency.ts. */
    maxConcurrentAgentProcesses: 3,
    /** Default `--diff-threshold`: max diff lines fed verbatim to the explaining LLM before
     * falling back to a file+line-range reference — see src/cli/args.ts. */
    defaultDiffThreshold: 400,
    /** New categories the escape hatch will accept per run before auto-rejecting further
     * proposals — see src/classification/escape-hatch.ts. */
    maxAcceptedNewCategories: 5,
    /** Classification coverage-repair attempts before giving up on the remaining changes — see
     * src/classification/coverage.ts. */
    maxCoverageRepairAttempts: 3,
    /** Explanation snippet-coverage amend attempts before giving up on the remaining changes —
     * see src/explanations/coverage.ts. */
    maxSnippetCoverageAttempts: 3,
    /** Fix attempts per invalid mermaid diagram before giving up and omitting it from the page —
     * see src/explanations/mermaid-verify.ts. */
    maxMermaidFixAttempts: 2,
    /** Line count above which a change is offered to the splitter (docs/adr/0016) — see
     * src/splitting. */
    splitThreshold: 120,
    /** Max changes per batch, for classification (src/classification/batch.ts) and splitting
     * (src/splitting). The char caps below are the tighter bound in practice (docs/adr/0025). */
    maxBatchSize: 40,
    /** Max total excerpt chars per classification batch, regardless of change count — see
     * src/classification/batch.ts. */
    maxBatchExcerptChars: 20_000,
    /** Max total *full* diff-text chars per split batch (docs/adr/0016) — see src/splitting.
     * Distinct from `maxBatchExcerptChars`, which caps *truncated* classification excerpts; the
     * splitter sends untruncated lines, so it needs its own budget. */
    maxSplitBatchDiffChars: 20_000,
    /** Diff excerpts longer than this are truncated (with a marker) before going into a
     * classification prompt — see src/classification/excerpt.ts. */
    maxExcerptChars: 2000,
    /** Per-side file size above which a referenced file's content isn't embedded for
     * client-side context expansion — see src/rendering/file-diffs.ts. */
    embedSizeCapBytes: 200 * 1024,
    /** Safety net against an unbounded pagination loop when fetching a PR's file list — see
     * `getAllPages` in src/forge/http.ts. */
    maxPrFilesSafetyNet: 3000,
    /** Attempts at fetching a PR's metadata while pushes keep changing its revisions — see
     * src/forge/pr-source.ts. */
    maxPrFetchAttempts: 3,
    /** Commit depth fetched for each of the checkout's base/head revisions — enough for `git
     * log`/`git blame` in an agent session to see real history, not just the tip commit — see
     * src/checkout/checkout.ts. */
    checkoutFetchDepth: 50,
  },

  /** Limits for the opt-in `--serve` review server (docs/adr/0019) — see src/serve/server.ts. */
  serve: {
    /** Max chars in a single review comment's text. Under GitHub's 65 536-char comment limit and
     * well under ARG_MAX (the body is passed as one `gh` argv element). */
    maxCommentChars: 60_000,
    /** Max bytes read from a `POST /api/comment` request body. Must exceed the worst-case JSON for
     * a max-length `text` — control chars escape to `\u00XX` (~6 bytes/unit), so ~360 KB for 60 000
     * units; 512 KB clears it. Tune together with `maxCommentChars`. */
    maxRequestBodyBytes: 512 * 1024,
  },
} as const;
