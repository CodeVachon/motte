---
id: 83
title: "The agent loop: pick work, then claim it"
state: Done
labels: [cli, agents, core]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T16:20:51Z
---

## Description

motte can say what is ready. It cannot say what to do next, and it cannot stop two agents doing the same thing.

`ready` returns a set in id order, so an agent facing fifteen ready issues picks arbitrarily. And the motivating case for this whole tool is several agents working at once — today they both run `ready`, both see #0042, and both start it. Nothing notices.

These two belong together: claiming is what you do with what `next` returns.

## Plan

1. #next — order the ready set rather than only filtering it
2. #claim — compare-and-set, so a second agent is refused rather than colliding
3. Both as MCP tools, since an agent is the caller that matters

## Notes

### 2026-08-05T16:20:51Z — claude (agent)

Both children landed. motte next orders the ready set and says why; motte claim refuses the second agent. Together they close the gap this epic named: an agent can now ask what to do and take it, and a second agent asking at the same moment gets told no rather than colliding.

Worth recording what the pair actually reveals about the tool: neither needed a new field on disk. The ordering reads the dependency graph and the tree that were already there, and claiming is two existing fields written together with a refusal in front. The format did not have to grow for the multi-agent story to work.
