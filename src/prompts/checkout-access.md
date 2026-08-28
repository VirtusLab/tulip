Your working directory is a checkout of the PR's head revision (commit
{{headSha}}) — you can read any changed or unchanged file there directly, whether or not
it's excerpted above. The complete unified diff for the whole PR is at .tulip/pr.diff — read or
grep it for the full picture beyond what's excerpted above. The pre-change content (commit
{{baseSha}}) of every changed file is under .tulip/base/<path> (e.g. src/foo.ts's base
version is at .tulip/base/src/foo.ts). Files added by the PR have no base version; files removed
by the PR have no working-tree (head) copy at all — their only content is under
.tulip/base/<path>. Reading a file's .tulip/base copy alongside its checked-out (head) copy, plus
.tulip/pr.diff, is the most reliable way to understand exactly what changed and why.
