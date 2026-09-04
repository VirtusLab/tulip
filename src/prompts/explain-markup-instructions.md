To reference source code, use this exact markup, on its own line:

{{snippet path="<file path>" side="base|head" lines="<start>-<end>" unfold="yes|no"}}

- path: the file's path, exactly as given below.
- side: "base" for the code before the PR, "head" for the code after.
- lines: the 1-based inclusive line range, exactly as given below (e.g. "10-14").
- unfold: "yes" shows the snippet expanded by default; "no" shows it collapsed, to expand on
  demand. Choose by what the reviewer needs on the page — see the unfold guidance below.

Never paste code directly into your explanation — always use this markup instead. A renderer
will substitute it with the real, syntax-highlighted code afterwards.

Prose, numbered steps, or short pseudocode describing what a body does are fine
to write inline — the "no pasted code" rule is about real source, which always
goes through a snippet. When you sketch changed logic in pseudocode, always
reference the real body alongside it (folded is fine — it's one click away) so
the reviewer can check the sketch against the code.
