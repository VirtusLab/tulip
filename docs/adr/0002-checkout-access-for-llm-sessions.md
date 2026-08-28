# 2. Give LLM sessions real checkout access

## Context

A live run on softwaremill/jox#351 surfaced two bugs that both boil down to the same
problem — the explaining LLM session doesn't actually have access to what it's supposed to be
explaining:

- **Empty working tree.** `src/github/checkout.ts` runs `git init` + `remote add` + `fetch
  --depth 1` for the base and head SHAs, but never checks out a working tree. `claude -p`
  sessions default to Read/Grep/Glob only (no Bash), so a session that wants to read a file
  beyond what's pasted into its prompt finds an empty directory with a `.git` and nothing else.
- **Diffs silently dropped.** `src/explanations/prompt.ts`'s `formatChange` decides whether to
  show a change's full diff or fall back to a file+line-range reference by checking the change's
  line count against `diffThreshold` (default 400) — correct — but then, when under threshold,
  prints `change.excerpt`, which phase 2 (classification) already truncated at 2000 *characters*
  (`config.limits.maxExcerptChars`) to keep cheap haiku classification prompts small. Any change
  whose lines total more than ~2000 characters (easily under 400 lines) gets its excerpt
  truncated, is detected as truncated, and is routed to reference-only — even though it's well
  within the line threshold that's supposed to govern this decision. `Change.lines` (the parsed
  diff's raw lines) was never truncated; only the derived `excerpt` string was. On the jox PR,
  this dropped 4 of 5 files' diffs from the explaining session's prompt.

Together: the model can't reliably read the code from disk, and it isn't reliably given the
diff in the prompt either.

## Decision

1. **Check out the head revision's working tree.** After fetching, run `git checkout
   <head-sha>` (detached) in the checkout dir, so Read/Grep/Glob (and the read-only git access
   below) see real files.
2. **Fetch deeper history.** Raise fetch depth from 1 to a configured value
   (`config.limits.checkoutFetchDepth`, default 50) for both base and head, so `git log`/`git
   blame` have more than a single commit to work with.
3. **Grant read-only git access, not blanket Bash.** Pass `--allowedTools` to every `claude`
   invocation, allowlisting `Bash(git diff:*)`, `Bash(git show:*)`, `Bash(git log:*)`,
   `Bash(git blame:*)` (`config.claude.allowedTools`). Everything else Bash-shaped still needs
   permission, which headless mode has no one to grant, so it stays denied. `--allowedTools`'s
   syntax is confirmed straight from `claude --help` (own example: `Bash(git *) Edit`) — a
   `Tool(prefix)` specifier, comma- or space-separated, one argv token per entry here.
4. **Fix `formatChange` to use the change's full diff lines, not the classification excerpt.**
   Add `lines: string[]` to `ClassifiableChange` (populated from `Change.lines` in
   `prepareClassifiableChanges`), and have `formatChange` quote `change.lines` when under
   threshold. `excerpt` (and its truncation) stays exactly as-is for phase 2 classification
   prompts — that truncation is intentional there, just never a valid stand-in for "the full
   diff" anywhere else. This also removes the need for `formatChange`'s truncation check
   entirely: the full lines are always available regardless of how phase 2 truncated the excerpt.
5. **Tell the model what it now has.** The explain/review prompts state that the working
   directory is a checkout of the PR's head revision, give the base and head SHAs, note that
   read-only git commands (diff/show/log/blame) are available via Bash, and that files may be
   read directly.

Pushback on the given guidance: none — the four decisions above match what was asked. The one
addition is including `Bash(git blame:*)`'s siblings' exact wildcard form (`git log:*` etc.)
under the same `Tool(prefix)` syntax `--help` documents for `Bash`, rather than inventing a
different pattern.

## Consequences

- Sessions can now `Read`/`Grep`/`Glob` the actual head-revision source tree, and run read-only
  git history/diff/blame commands — closing the "empty checkout" gap.
- Every change at or under `diffThreshold` lines is now genuinely shown in full, regardless of
  its character length — closing the "silently dropped diff" gap. `isExcerptTruncated` remains
  used (and tested) for its original purpose: classification prompts.
- Checkout does one more `git checkout` per PR, and fetches ~50x more history — slightly slower
  and more disk, still cheap for a single PR's worth of commits.
- `ExplainCategoryInput`/`ExplainCategoriesInput` (and the review-loop equivalents) grow a
  `baseSha`/`headSha` pair, threaded from `PrMetadata` through `pipeline/run.ts` — a small,
  mechanical widening of an existing interface.
- `--allowedTools` is fixed and global (not per-invocation configuration) — if a future phase
  needs a different tool allowlist, this will need to become a parameter instead of a constant.

## Implementation plan

1. `src/config.ts`: add `limits.checkoutFetchDepth` (50) and a new `claude.allowedTools` group.
2. `src/github/checkout.ts`: use the configured depth; add a `git checkout <head-sha>` step.
   Update `checkout.test.ts`'s mocked-git test for the new depth/checkout call; add a hermetic
   test that runs real `git` against a local fixture repo (remote rewritten to a local path, no
   network) and asserts the checkout directory actually contains the head revision's files.
3. `src/claude/runner.ts`: add `--allowedTools` (from config) to every built argv. Update
   `runner.test.ts`'s argv-shape assertions.
4. `src/classification/types.ts` + `prepare.ts`: add `ClassifiableChange.lines`, populated from
   `Change.lines`. Update `prepare.test.ts`.
5. `src/explanations/types.ts`: add `baseSha`/`headSha` to `ExplainCategoryInput`; thread through
   `explanations/orchestrate.ts` (`ExplainCategoriesInput`), `explain.ts`, `review.ts`, and
   `pipeline/run.ts` (from `metadata.base.sha`/`metadata.head.sha`).
6. `src/explanations/prompt.ts`: `formatChange` quotes `change.lines` (not `change.excerpt`)
   under threshold; drop the excerpt-truncation branch. Add the cwd/SHA/read-only-git paragraph
   to `buildExplainPrompt` and `buildReviewPrompt`. Update `explain.test.ts` / `review.test.ts` /
   `orchestrate.test.ts` for the new required fields and the fixed threshold behavior.
7. Update every other test file constructing a `ClassifiableChange`/`ExplainCategoriesInput`
   literal to satisfy the widened types (`lines`, `baseSha`/`headSha`).
8. `pnpm build && pnpm test && pnpm lint` green before each commit; one commit per step above
   (config, checkout, allowedTools, classification `lines`, explanation prompt/SHA wiring).
9. Manual, no-LLM verification: fetch softwaremill/jox#351's base/head SHAs (`gh pr view`) and
   run `createCheckout` directly against the real PR (network git, no `claude` calls) to confirm
   the temp dir ends up with a real working tree.
