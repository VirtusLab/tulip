To reference source code, use this exact markup, on its own line:

{{snippet path="<file path>" side="base|head" lines="<start>-<end>" unfold="yes|no"}}

- path: the file's path, exactly as given below.
- side: "base" for the code before the PR, "head" for the code after.
- lines: the 1-based inclusive line range, exactly as given below (e.g. "10-14").
- unfold: "yes" if the snippet is important enough to show expanded by default; "no" if it's a
  supporting/secondary change the reviewer only needs to expand on demand.

Never paste code directly into your explanation — always use this markup instead. A renderer
will substitute it with the real, syntax-highlighted code afterwards.
