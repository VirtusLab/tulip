To reference source code, use this exact markup, on its own line:

{{snippet path="<file path>" base="<start>-<end>" head="<start>-<end>" unfold="yes|no"}}

- path: the file's path, exactly as given below.
- base / head: the 1-based inclusive line ranges of the change, exactly as given below (e.g.
  "10-14"). "base" is the code before the PR, "head" the code after. Include both for an in-place
  modification, so it renders as one before/after diff; include only "head" for an addition, only
  "base" for a deletion. At least one is required. Copy the change's own base/head ranges given
  below into one snippet — one change is one snippet.
- unfold: "yes" shows the snippet expanded by default; "no" shows it collapsed, to expand on
  demand. Choose by what the reviewer needs on the page — see the unfold guidance below.

Never paste code directly into your explanation — always use this markup instead. A renderer
will substitute it with the real, syntax-highlighted code afterwards.

Prose, numbered steps, or short pseudocode describing what a body does are fine
to write inline — the "no pasted code" rule is about real source, which always
goes through a snippet. When you sketch changed logic in pseudocode, always
reference the real body alongside it (folded is fine — it's one click away) so
the reviewer can check the sketch against the code.
