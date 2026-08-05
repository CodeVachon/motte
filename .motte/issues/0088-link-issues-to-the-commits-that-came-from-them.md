---
id: 88
title: Link issues to the commits that came from them
state: Todo
labels: [cli, core, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T15:49:58Z
---

## Description

git already holds the answer to 'what code came out of this issue' — commit messages here carry `#0042` and `Closes #0042` — and motte cannot see it. The two records the project treats as one system have no join.

`git log --grep` is the whole implementation. `motte show 42` listing its commits, and `motte log 42` interleaving them with the transitions, turns the convention into something queryable. A prepare-commit-msg hook that stamps the id of whatever is In Progress makes the convention hold without anybody remembering it.

## Plan

1. `commitsFor(id)` over `git log --grep`, tolerating a repository with no commits or no git at all
2. `motte show <ref>` lists them; `motte log <ref>` interleaves them with the transitions
3. `motte install --hooks` writes an opt-in prepare-commit-msg hook, merging rather than clobbering
4. `motte uninstall` removes exactly that hook, the way it removes the AGENTS.md block
5. Tests against a real temp repository with real commits, not a mocked git
