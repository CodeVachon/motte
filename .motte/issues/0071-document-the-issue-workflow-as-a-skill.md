---
id: 71
title: Document the issue workflow as a skill
state: Done
labels: [docs]
created: 2026-07-30T15:39:47Z
updated: 2026-07-30T15:39:47Z
---

## Description

The rules for working a ticket lived in my head and in scattered notes across the backlog. Two red commits reached CI because the ordering rule — verify after the last mutation, gate on exit codes — was never written down.

## Plan

1. .claude/skills/work-issue/SKILL.md covering pick-up through CI-green
2. Make prettier, typecheck, test, doctor, code review and fallow all mandatory
3. Point AGENTS.md at it

## Notes

### 2026-07-30T15:39:47Z — claude (agent)

Committed under .claude/skills/ rather than kept local, for the same reason the issues are committed:
a per-machine copy means two people follow different rules.

Grounded in what actually went wrong here rather than generic advice. Each rule cites the failure that
produced it — the Bun-globals constraint, the format/test write race, the four flawed fixtures that sent me
chasing non-bugs, the plan note that would have broken prune, and the two red pushes.

Two things it says that are worth arguing with later. There is no ESLint in this project, so the skill
names typecheck as the lint; if ESLint ever lands, that section needs rewriting rather than extending.
And it forbids using fallow suppressions to reach a pass, on the evidence of two findings in a row where
the suppression would have hidden a real design problem — a blanket ban may prove too strict, but the bar
should be high and stated.
