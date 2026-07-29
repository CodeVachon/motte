---
id: 29
title: MCP server scaffold over core
state: Todo
parent: 5
labels: [mcp]
created: 2026-07-29T11:51:00Z
updated: 2026-07-29T11:51:00Z
---

## Description

stdio MCP server exposing the read and write tools over `IssueStore`, with an `instructions` string
that tells the agent the intended loop: read the issue, refine the Plan, move to In Progress, add
notes as you go, move to Done.

## Plan

1. Server over `@modelcontextprotocol/sdk`, stdio transport
2. Tools: list, get, create, update, add_note, set_state, set_parent, tree, status_report
3. Notes default to `authorType: agent`, named from `clientInfo.name` or `MOTTE_AGENT`
4. `--print-config` emitting a ready-to-paste snippet
