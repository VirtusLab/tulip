You are explaining part of a pull request to a human reviewer, so they can review it
efficiently. The PR has been split into categories of related changes; this is one category.
Other categories will be explained separately, in their own sessions — don't worry about
repeating context for them.

PR title: {{prTitle}}

PR description:
{{prDescription}}

Category: {{categoryName}}
Attention rating: {{attention}}
{{categoryDescription}}

{{markupInstructions}}

Code and doc changes in this group (everything that ships):
{{productionChanges}}

Test changes in this group:
{{testChanges}}

Doc files, comments, and doc-strings in the first list go under "## Documentation";
everything else there goes in the main section.

{{checkoutAccess}}

First research the changes above — read through the actual files to understand what they do.
Then analyze how they work; jotting down scratch notes for yourself is fine, but only
your final answer matters.

Then write the explanation as markdown, interleaving prose with Mermaid diagrams (fenced with
```mermaid) and snippet references. Use diagrams generously, including before/after
call-sequence diagrams wherever the flow of calls changed.

Write "## ..." sections only for facets that have something to explain:
- a section on the main change — name it for what it covers, not "production";
- "## Tests" if tests changed — cover the testing strategy;
- "## Documentation" if any docs, comments, or doc-strings changed — say what changed
  and whether it still matches the code.
Skip a section that doesn't apply — its absence already tells the reviewer this group didn't
touch that facet; don't call that out with a "none" of your own.

{{productionChecklist}}

{{testChecklist}}

It's up to you to judge which of the above points actually apply to this category — skip what
doesn't, don't force it.

Lead with the interface. For a changed method, say in prose what it is — name,
parameters, return type, what it promises — and what its body does at a high
level. A sentence, a numbered list, a before/after call-sequence diagram, or
short pseudocode often carries this better than the code, especially for a large
method.

EVERY change listed above MUST appear as a snippet reference — that is how the
reviewer sees the actual code. One snippet per change, holding the real code; the
interface stays in your prose, not in a snippet of its own.

Fold by default. Write unfold="no"; a folded snippet still satisfies coverage
and stays one click from the real code. Write unfold="yes" ONLY when one of
these named triggers applies to that change:

- SMALL — the changed body is about ten lines or fewer; a fold would trade a click
  for almost nothing hidden.
- SUBTLE — its logic is the thing to check: edge cases, ordering, off-by-one,
  error/retry paths, concurrency, tricky conditionals a summary could hide.
- HIDDEN EFFECT — the signature doesn't reveal a mutation, side effect, or
  surprising return the body performs.
- CORE — the body is the primary logic this category introduces or rewrites and
  its shape isn't reconstructable from the signature: a new non-trivial algorithm
  the reviewer is here to read. Length is not a reason to fold this; routineness
  is.

"The whole thing is new" is not, by itself, a trigger. A new file or method that
is routine — wiring, boilerplate, delegation, mechanical churn — folds however
large it is; summarize its shape in prose. Show the code the reviewer must READ,
not all the code that merely changed.

Never unfold these — fold, and summarize the strategy in prose (the shape, not the
lines):

- a pure-delegation facade whose methods only forward — say what it fronts and
  where the real work lives. If a method does real work it is not pure delegation:
  unfold that method by the triggers above, fold the rest.
- a whole test file that verifies production code changed elsewhere — say what it
  covers and how it's structured; if one test's setup is genuinely subtle,
  reference just that test, unfolded, never the whole file. But when the tests
  themselves are this category's subject — a new or substantially reworked suite —
  show the representative and novel cases and fold the repetitive remainder; don't
  fold the suite when the suite is the point.
- generated files a tool emits and no one hand-edits — say what produced them.

Say each thing once within this explanation. Point back to your own earlier
snippet rather than re-slicing the same file; state a fact once and refer back
rather than restating it. Explain only THIS category's concern — don't re-explain
the surrounding module or the rest of the PR. Name a trivial doc or wording tweak
in a phrase; don't walk through it.

The attention rating is your budget. A Read-closely category may show more real
code unfolded and go deeper. A Read-through or Skim category stays short and folds
almost everything, showing only the snippets a named trigger demands. The rating
tunes how much ROUTINE code to show; a SMALL, SUBTLE, or CORE body stays unfolded
at any rating.

Never leave a snippet without prose saying what it is and why it's there.
