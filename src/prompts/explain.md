You are explaining part of a pull request to a human reviewer, so they can review it
efficiently. The PR has been split into categories of related changes; this is one category.
Other categories will be explained separately, in their own sessions — don't worry about
repeating context for them.

PR title: {{prTitle}}

PR description:
{{prDescription}}

Category: {{categoryName}}
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
interface stays in your prose, not in a snippet of its own. Choose unfold by what
the reviewer needs on the page:

- unfold="yes" when the changed body is the thing to read: it's small, or its
  logic is subtle (edge cases, ordering, error/retry paths, concurrency), or the
  signature hides a side effect. Don't fold the code the reviewer came for.
- unfold="no" when your prose, diagram, or pseudocode already conveys the
  change — a large body whose essence is its signature and behavior, or a rename,
  type change, move, or call-site rewiring where the body itself didn't change.
  Folded still satisfies coverage and stays one click from the real code.

The category's attention rating tunes this: for a Read-closely group show more
real code unfolded; for a Skim group summarize and fold more. Never override the
rule above — a subtle body change stays unfolded whatever the rating.

Never leave a snippet without prose saying what it is and why it's there.
