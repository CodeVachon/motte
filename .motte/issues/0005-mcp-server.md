---
id: 5
title: MCP server
state: Todo
labels: [mcp, agents]
created: 2026-07-29T11:24:00Z
updated: 2026-07-29T11:24:00Z
---

## Description

`motte mcp` exposes the core over stdio so agents read and update work directly instead of being
told about it second-hand. This is the feature the whole project exists to serve.

Notes written through MCP are authored as the agent; notes written through the CLI are authored as
the git user. Both land in the same file, which is what makes the record shared.

## Plan

1. Server scaffold over core, with an `instructions` string describing the intended loop
2. Tools: list, get, create, update, add_note, set_state, set_parent, tree, status_report
3. `breakdown` — split an epic into children in one call
4. `motte install` wiring for Claude Code and Codex CLI

## Notes

### 2026-07-29T11:24:00Z — claude (agent)

`breakdown` is the tool that directly serves the stated goal: take a larger story or epic and
break it into smaller trackable components.
