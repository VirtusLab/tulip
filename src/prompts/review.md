You are reviewing an explanation written for a human reviewer of part of a pull
request.

PR title: {{prTitle}}

PR description:
{{prDescription}}

Category being explained: {{categoryName}}
Attention rating: {{attention}}
{{categoryDescription}}

Here is the explanation:

{{markdown}}

Here are the actual changes the explanation is supposed to cover — use these to check the
explanation's claims, not just its internal consistency:

Code and doc changes in this group (everything that ships):
{{productionChanges}}

Test changes in this group:
{{testChanges}}

Doc files, comments, and doc-strings in the first list go under "## Documentation";
everything else there goes in the main section.

{{checkoutAccess}} Use this to verify claims against the actual code too, not just
against the change list above.

Review the explanation for:
- top-down structure — does it open with the big picture (how the pieces fit end-to-end, with an
  orienting diagram where the flow warrants one) before drilling into individual changes? Flag
  leading with a specific method or snippet before the overall shape is set, or an orienting
  diagram buried at the end. Scale to the rating — a Skim or trivial single-file category needs
  only a sentence or two, and no diagram when the flow is trivial.
- clarity — is it easy to follow for a reviewer who hasn't seen the code yet?
- conciseness and minimalism — is it concise and minimal? Flag over-explaining the obvious,
  restating what the code plainly shows, and dwelling on trivial or boilerplate parts. Every
  sentence should earn its place — flag padding, redundancy, and belaboring a simple point.
- correctness — does every claim actually match the changes above? Flag anything invented,
  mistaken, or unsupported by them. Where the explanation summarizes a method or sketches
  pseudocode, check that summary against the referenced real code and flag drift.
- earned references — every snippet has prose saying what it is and why it matters. Flag
  snippets that appear only to satisfy coverage and folded snippets never explained — but a
  trivial change earns a proportionate phrase, not a paragraph; a one-line mention of a trivial
  tweak is enough and is not a violation, and trivial sibling snippets may share one sentence —
  don't require separate prose for each. A change marked "already explained under ..." is
  reference-only: it is owned by another category, so a one-line note plus a
  {{catref id="..."}} backlink and no snippet is correct — don't flag it as missing or
  under-explained (a focused slice for it is allowed but not required).
- fold discipline & attention budget — folded (unfold="no") is the default; an unfolded snippet
  must earn it with a named trigger (a SMALL ~10-line body, SUBTLE logic, a HIDDEN side effect,
  or the CORE new logic under review). Flag large routine bodies, forwarding facade methods,
  whole test files (unless the tests are this category's subject), and generated files shown
  unfolded, and any unfold you can't tie to a trigger. Match depth to this category's rating
  ({{attention}}). SUBTLE, HIDDEN EFFECT, and CORE bodies are must-see — never flag them unfolded,
  at any rating. SMALL is a convenience that yields to the rating: a correctly-unfolded SMALL body
  is fine on Read-closely, but on a Read-through or Skim category a SMALL body should be folded —
  flag it shown unfolded there, along with any Skim/Read-through explanation that runs long.
- no duplication — flag a fact restated elsewhere in this explanation, the same file's lines
  shown in more than one snippet, and prose spent walking through a trivial doc or wording tweak.

Reply with approved: true if it's good as-is. Otherwise reply with approved: false and a list of
specific issues to fix.
