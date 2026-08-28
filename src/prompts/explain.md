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

Start with a one-line coverage strip so the reviewer sees at a glance what this group
ships, for example:

Coverage — Tests: added · Docs: none

(the strip covers tests and docs only — the main section always covers the code itself).
Write "none" for a facet with nothing here; that absence is itself useful — it tells
the reviewer whether the change shipped tested and documented.

Then write "## ..." sections only for facets that have something to explain:
- a section on the main change — name it for what it covers, not "production";
- "## Tests" if tests changed — cover the testing strategy;
- "## Documentation" if any docs, comments, or doc-strings changed — say what changed
  and whether it still matches the code.
Skip a section that would only say "none"; the coverage strip already carries that.

{{productionChecklist}}

{{testChecklist}}

It's up to you to judge which of the above points actually apply to this category — skip what
doesn't, don't force it.

EVERY change listed above MUST appear as a snippet reference somewhere in your explanation — that
is how the reviewer gets to see the actual code. Mark supporting changes (not crucial to
understanding the category on its own) with unfold="no"; mark the important ones unfold="yes".
