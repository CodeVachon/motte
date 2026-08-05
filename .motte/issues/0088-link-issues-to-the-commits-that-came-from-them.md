---
id: 88
title: Link issues to the commits that came from them
state: Done
assignee: claude
labels: [cli, core, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T17:26:39Z
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

## Notes

### 2026-08-05T17:26:38Z — claude (agent)

commitsFor over git log --grep, matching both #0042 and #42 with a guard so #42 does not match #421. motte show lists an issue's commits, motte log interleaves them with the transitions and notes — an issue's whole story in one view.

The bug worth recording: git reports the author's local offset from %aI, and interleaving that with the UTC timestamps in the event log put a commit four hours before the issue it mentions was created. It read as impossible rather than as a timezone. Commit times are converted to UTC to the second now, matching frontmatter and events.

The hook needed a machine-readable answer to 'which issue is this commit for', so motte current came with it: the one issue you have claimed and started, or silence. Silence rather than a guess when two are claimed — the wrong reference in permanent history is worse than none, and #0085's claiming is what makes 'one issue' well-defined at all.

Refs: #0042 rather than a bare #0042, which is the detail that would have made this look broken: git strips lines starting with # from a commit message, so the bare form vanishes from an interactive commit. Verified with a real GIT_EDITOR commit, not just -m.

fallow then caught what I had actually done wrong: hooks.ts and instructions.ts had the same three exports and the same block mechanics twice. Extracted to markedBlock.ts — one statement of 'everything between the markers is motte's' — and the 114 install tests passed unchanged, which is what makes it a refactor. The name collision went too, rather than being suppressed.
