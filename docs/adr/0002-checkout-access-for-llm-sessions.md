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
3. ~~**Grant read-only git access, not blanket Bash.** Pass `--allowedTools` to every `claude`
   invocation, allowlisting `Bash(git diff:*)`, `Bash(git show:*)`, `Bash(git log:*)`,
   `Bash(git blame:*)`.~~ **Superseded** — see "Amendment: no Bash git grant at all" below. Left
   struck through rather than deleted: it's what shipped first, and why it was wrong is the point
   of the amendment.
4. **Fix `formatChange` to use the change's full diff lines, not the classification excerpt.**
   Add `lines: string[]` to `ClassifiableChange` (populated from `Change.lines` in
   `prepareClassifiableChanges`), and have `formatChange` quote `change.lines` when under
   threshold. `excerpt` (and its truncation) stays exactly as-is for phase 2 classification
   prompts — that truncation is intentional there, just never a valid stand-in for "the full
   diff" anywhere else. This also removes the need for `formatChange`'s truncation check
   entirely: the full lines are always available regardless of how phase 2 truncated the excerpt.
5. **Tell the model what it now has.** The explain/review prompts state that the working
   directory is a checkout of the PR's head revision, give the base and head SHAs for reference,
   and that files may be read directly (no mention of running git commands — see the amendment).

Pushback on the original guidance: none at the time — decisions 1, 2, 4, 5 above (and the
original form of 3) matched what was asked. Decision 3 turned out to be wrong in a way review
caught before it shipped to production; see the amendment.

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
- `--allowedTools` is never passed by default (see the amendment) — sessions get repo access
  purely through Read/Grep/Glob on the checked-out working tree, no Bash grant at all.

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

## Amendment: no Bash git grant at all

### Context

A security review of the above, verified live before it shipped, found decision 3
(`Bash(git diff:*)`/`show`/`log`/`blame`) CRITICAL: it lets the model run e.g.

```
git log --format=%B -1 --output=/any/writable/path
```

writing a file with fully attacker-controlled content — the PR author's own commit message —
anywhere the OS user running tulip can write. `--output=<path>` (and blame/diff's own `-O`) can
appear at any argv position, so `claude`'s `--allowedTools`/`--disallowedTools` matching (a
prefix match on the command string) cannot distinguish `git log --oneline` from `git log
--output=<path>`: both start with the allowed prefix `git log`. This is reachable purely via
prompt injection — a malicious PR's commit message or diff content, fed into the explaining
session's prompt, can instruct it to run the write. The reviewer verified this executes with
zero denials from `claude`.

A narrower fix (regex-checking the allowlist entries, or a wrapping shim script that shadows
`git` on `PATH` and rejects write/escape flags before exec-ing the real binary) was considered
and prototyped, but the underlying justification for granting Bash *at all* turned out to be
weak: decision 1 already gives sessions the head revision's real working tree, and `claude -p`
sessions get Read/Grep/Glob on it with **no allowlist needed** — that was true before this ADR
and remains true. The only thing `Bash(git ...)` added was `git log`/`blame` history beyond the
working tree's current state, which nothing in the jox#351 incident (checkout access, diff
visibility) actually required. Removing the grant removes the vector entirely, with no shim to
maintain or trust.

### Decision

- `config.claude.allowedTools` defaults to `[]`. The field (and `buildArgs`' handling of it) stay
  in place — `buildArgs` omits `--allowedTools` from argv entirely when the list is empty, rather
  than passing an empty flag — so the mechanism remains available, just unused.
- No shim, no wrapper, no `--disallowedTools` allowlist-of-exclusions: none of these can be
  verified airtight against an argv-position-independent flag, and none were needed once Bash
  access itself is off the table.
- Explain/review prompts drop the "read-only git commands" wording; they still tell the session
  its cwd is the head checkout and give both SHAs (for reference / correlating with the diffs
  already in the prompt), but no longer imply it can run git itself.
- `createCheckout`'s own git calls (init/remote/fetch/checkout — code-driven, not
  model-driven) are separately isolated from the operator's `~/.gitconfig`/system config via
  `GIT_CONFIG_NOSYSTEM=1`/`GIT_CONFIG_GLOBAL=/dev/null`, so a malicious PR's `.gitattributes`
  can't invoke an operator-configured smudge/textconv filter during checkout. This was already
  planned (finding 6 of the same review) and is orthogonal to the Bash-grant question — it holds
  regardless of whether sessions ever get git access again.

### Consequences

- The arbitrary-file-write vector is closed: sessions have no way to invoke `git` (or any other
  command) at all in the default configuration.
- Sessions lose `git log`/`git blame` history beyond the checked-out head revision. Nothing in
  scope currently needs it; if a future need justifies it, re-adding any command execution here
  requires a hardened wrapper (shim shadowing `git` on `PATH`, rejecting write/escape flags
  server-side before exec-ing the real binary, with output-flag detection independent of argv
  position) — not a bare `--allowedTools` entry, which this incident showed is insufficient by
  itself for anything that can write files. Left as explicit future work, not implemented now.
- `config.claude.allowedTools` and its plumbing (`buildArgs`' empty-list check) stay as
  documented dead-but-ready code for that future work, rather than being deleted outright.

## Amendment: deterministic materialization of the diff and base files

### Context

The no-Bash-grant decision above left two gaps for a session trying to actually understand a
change, neither needing any git access to close: it only ever sees the *head* revision on disk
(no base/before content to diff against by eye), and the full unified diff only reaches it as
whatever's pasted into the prompt — which `diffThreshold` deliberately truncates for large
changes (see src/explanations/prompt.ts's `formatChange`), so a session can never read the
complete diff for a large change no matter how much it wants to.

### Decision

Materialize both, as plain files, code-driven (not model-run) right after the checkout is
created (`materializeChangeArtifacts`, src/github/materialize.ts, called from
src/pipeline/run.ts):

- The complete unified diff (`PrMetadata.diff`, untruncated) is written verbatim to
  `.tulip/pr.diff`.
- Every changed file's pre-change content is written to `.tulip/base/<path>` (the base-side path
  for a rename), fetched via `PrCheckout.getFileAtBase` — the same git-object-DB lookup the
  renderer already uses. Binary files and added files (nothing existed at base) are skipped. The
  post-change (head) version is never duplicated — it's already the checkout's working tree.

Both live under the checkout's own temp dir, so `PrCheckout.cleanup()` removes them for free.
The explain/review prompts (`describeCheckoutAccess`) now point sessions at both paths,
additively — the existing per-change diff excerpts/references stay, still the primary grounding.

### Consequences

- A session can always get the complete diff and a real base/head comparison for any file,
  regardless of `diffThreshold` or prompt size — no git access, no new attack surface (the
  written paths are derived from the already-parsed diff, not session input).
- One more filesystem write pass per PR (proportional to changed-file count); negligible next to
  the checkout itself.
