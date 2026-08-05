---
id: 83
title: "The agent loop: pick work, then claim it"
state: Todo
labels: [cli, agents, core]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T15:49:57Z
---

## Description

motte can say what is ready. It cannot say what to do next, and it cannot stop two agents doing the same thing.

`ready` returns a set in id order, so an agent facing fifteen ready issues picks arbitrarily. And the motivating case for this whole tool is several agents working at once — today they both run `ready`, both see #0042, and both start it. Nothing notices.

These two belong together: claiming is what you do with what `next` returns.

## Plan

1. #next — order the ready set rather than only filtering it
2. #claim — compare-and-set, so a second agent is refused rather than colliding
3. Both as MCP tools, since an agent is the caller that matters
