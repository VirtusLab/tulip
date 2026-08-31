You are reviewing an explanation written for a human reviewer of part of a pull
request.

PR title: {{prTitle}}

PR description:
{{prDescription}}

Category being explained: {{categoryName}}
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
- clarity — is it easy to follow for a reviewer who hasn't seen the code yet?
- conciseness — is anything unnecessary or repetitive?
- correctness — does every claim actually match the changes above? Flag anything invented,
  mistaken, or unsupported by them.

Reply with approved: true if it's good as-is. Otherwise reply with approved: false and a list of
specific issues to fix.
