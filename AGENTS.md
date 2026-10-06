# Agent Guide

## Code Comments

- Default to no comment. Write one only when it states something the code cannot express on its own:
  ordering that matters, an upstream quirk (a browser, Node, an MCP client, a provider API), a value
  that must stay in step with another file or system, a choice a reader would intuitively reverse,
  or an external reference the code cannot imply.
- When a comment explains what the code does, rename the thing and delete the comment.
- Never put tickets, issue or PR numbers, commit hashes, authors, dates, or change history in a
  comment. Git owns that.
- A comment is one line of at most 160 characters in present tense. No narration, no restatement of
  the next lines, no section banners, no changelogs, no commented-out code, and no JSDoc or
  docstring that repeats what types already carry.
- Tool directives (`eslint-disable`, `@ts-expect-error`, `noqa`, `type: ignore`) stay, each with
  its reason.
- Every comment a change adds or rewrites must comply, and `/review` rejects one that does not.
