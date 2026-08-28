For the production code, cover what's relevant — skip what doesn't apply:
- how it relates to the PR's title and description
- what functionality is implemented
- the main algorithms and data structures used
- external services used, and how
- the code's complexity — CPU and memory
- whether it touches mutable state (especially global mutable state), and other side effects
- old vs. new call-stack diagrams (as Mermaid sequence diagrams), if the flow of calls changed
- any new dependencies, and why they're needed
- whether this is a refactor (and so trivial to review), and what refactorings are involved
