# 6. Externalized prompt templates

## Context

Every LLM prompt tulip sends lives as a TS template literal, spread across `src/claude/
preamble.ts`, `src/categories/generate.ts`, `src/categories/consult.ts`, `src/classification/
prompt.ts`, and `src/explanations/prompt.ts`. Reading or tweaking prompt prose means reading and
editing TypeScript — finding the right template literal among string-building logic, dodging
`${...}` interpolations and escaped backticks. The author wants prompt wording auditable and
editable as plain text, without touching code.

The prompts aren't uniform text, though: they interpolate dynamic data (PR title, SHAs, category
lists, diff excerpts, checklists) and one has a real conditional (an escape-hatch outcome is one
of two fixed verdict sentences depending on whether the proposal was accepted). Any
externalization has to keep that logic somewhere sensible, not turn `.md` files into a templating
language.

## Decision

**Move all fixed prompt prose into `src/prompts/*.md`; keep dynamic assembly in TS.**

1. **One prompt directory**, `src/prompts/`, holding a `.md` file per prompt (or partial —
   shared static blocks like the special-categories explanation or the markup instructions get
   their own file) plus the loader module itself. The loader lives *in* the directory, not next
   to it, so its `.md` files resolve via a stable `import.meta.url`-relative `"./"` in both dev
   (tsx/vitest running from `src/`) and built (`dist/`) form — no `process.cwd()` guessing.
2. **A tiny, strict, typed renderer** (`src/prompts/loader.ts`): `renderPrompt(name, vars)`
   reads `src/prompts/<name>.md` (cached after the first read), and substitutes every
   `{{placeholder}}` with `vars[placeholder]`. It throws if the template references a
   placeholder missing from `vars`, or if `vars` supplies a key the template doesn't reference.
   No conditionals, no includes, no partial-transclusion syntax — a template is flat text plus
   placeholders. `templatePlaceholders(name)` exposes a template's declared placeholder set for
   tests.
3. **Logic stays in TS.** Which prompt to render, how to format a change list or category list
   into the string a placeholder receives, and any conditional assembly (e.g. the escape-hatch
   outcome's accepted-vs-rejected verdict — itself two small `.md` partials TS picks between and
   renders) all stay thin TS builder functions, unchanged in shape from before. Only the fixed
   prose moved; the string-building functions that were already isolated (`formatCategoryList`,
   `formatChanges`, `describeCheckoutAccess`, etc.) still exist and still produce the values
   passed in as `vars`.
4. **Placeholder-coverage test replaces the lost compile-time coupling.** With prose outside
   TypeScript, the compiler can no longer catch a call site that forgot a field a template needs
   (or a template that dropped a placeholder a call site still supplies). `src/prompts/
   coverage.test.ts` enumerates every `.md` file and asserts, via `renderPrompt`'s strict
   checking, that its declared placeholders exactly match a manifest mirroring each real call
   site's vars — this is the explicit runtime guard for what TS used to catch for free.
5. **Build wiring.** `.md` files are hand-edited source, committed to git (not gitignored, unlike
   the vendored rendering bundles). `scripts/copy-assets.mjs` copies `src/prompts/*.md` into
   `dist/prompts/` at `pnpm build`, next to the compiled `loader.js`, mirroring how it already
   copies `src/rendering/assets` into `dist/rendering/assets`.

## Consequences

- Prompt wording is now readable and editable as plain `.md` text, independent of TypeScript —
  the stated goal.
- The type checker no longer enforces that a prompt's interpolation points and a call site's
  supplied fields agree; `coverage.test.ts` is the explicit, must-pass substitute, plus
  exact-equality tests (`*.test.ts` per phase) asserting each builder's rendered output is
  byte-identical to the pre-refactor template-literal output for representative inputs.
- One more build step (`copy-assets.mjs` copying `.md` files) that must stay in sync with where
  `tsc` emits `loader.js`; `dist.test.ts` checks this post-build so a real `tulip` run doesn't
  silently fail to find its prompts.
- Very small, mostly-static conditional text (the escape-hatch verdict) is now two `.md`
  partials plus a TS `?:` picking between them, rather than one inline ternary — marginally more
  indirection for that one case, in exchange for that prose also being externalized.

## Alternatives considered

- **Leave prompts as TS template literals.** Rejected — doesn't address the stated goal; prose
  stays entangled with string-building logic and requires editing/understanding TypeScript to
  change wording.
- **In-code string constants (e.g. one big `PROMPTS` object in TS), not separate files.**
  Rejected — still TypeScript, still requires a code change and redeploy semantics to edit
  wording; doesn't give the "plain text file, auditable and editable" property that motivated
  this change.
- **A real templating engine (Handlebars, Mustache, etc.) with conditionals/includes in the
  template.** Rejected — the actual conditional logic here (which prompt to send, how to format
  a list, escape-hatch verdict selection) is a handful of cases, cheaply expressed in TS; pulling
  it into template syntax would make the `.md` files harder to read as prose and add a
  dependency for no real gain.
