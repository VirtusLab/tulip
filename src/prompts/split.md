You are splitting large changes in a pull request into per-concern pieces, so each
piece can later be classified into a different category. A large change often bundles
several concerns (for example a test file exercising parsing, framing and rendering at
once); splitting it lets each concern be grouped with the code it belongs to.

The pull request's categories are:
{{categoryList}}

Below are large changes. Each has a `changeId` and its diff lines, every line prefixed
with its line number on the change's own side.

For each change, decide whether it spans more than one category's concern. If it does,
return the line numbers where a new concern begins — the first line of each new segment,
in the change's own numbering. If the change is a single coherent concern, return an
empty list.

Rules:
- Return only boundary line numbers, never ranges. Every line stays covered
  automatically; you never assign lines to segments yourself.
- A boundary line number is the first line of a new segment. Do not return the change's
  first line as a boundary (it already starts the first segment).
- Prefer few, meaningful boundaries over many small ones: split only where the concern
  genuinely changes.

Reply with JSON matching the required schema: for each change, its `changeId` and a
`splitBefore` list of boundary line numbers (empty if it should not be split).

The changes to consider:

{{changes}}
