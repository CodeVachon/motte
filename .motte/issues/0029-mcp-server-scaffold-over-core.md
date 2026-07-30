---
id: 29
title: MCP server scaffold over core
state: Done
parent: 5
labels: [mcp]
created: 2026-07-29T11:51:00Z
updated: 2026-07-30T01:36:47Z
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

## Notes

### 2026-07-30T01:36:47Z — claude (agent)

Done. Eleven tools over stdio, plus --print-config for agents motte install does not cover yet.

Two design decisions worth keeping.

The project is resolved per tool call, not at startup. A server that fails to start shows up in the
client as broken with no explanation; one that starts and returns "no motte project was found — run
motte init" as a tool error tells the agent what to do about it. Verified by pointing the server at an
empty directory: it starts, every tool explains itself, stderr stays empty and the protocol stream stays
valid.

Notes are attributed from the MCP handshake's clientInfo.name, so they read "claude-code (agent)" rather
than a generic label. --agent overrides it, MOTTE_AGENT still works.

The constraint that shaped the implementation: with stdio transport, stdout IS the protocol channel, so
nothing human-readable may ever be written there. Verified that a full session emits only valid JSON
lines and that stderr is empty throughout.

ready_issues is listed first and named in the instructions, because "what can I actually pick up" is the
question an agent has at the start of a session, and list_issues answers a different one. Read-only tools
carry readOnlyHint so a client can treat them differently.
