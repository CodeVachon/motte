---
id: 31
title: motte install — agent wiring
state: Todo
parent: 5
labels: [mcp, agents]
created: 2026-07-29T11:53:00Z
updated: 2026-07-29T11:53:00Z
---

## Description

Write the MCP server config into the agents this project supports at v0.1: Claude Code (project
`.mcp.json`, or user `~/.claude.json`) and Codex CLI (`~/.codex/config.toml`).

Must merge into existing config rather than overwrite it, and be idempotent.

## Plan

1. Detect which agents are present
2. Merge into `.mcp.json` and `~/.codex/config.toml`, preserving unrelated entries
3. `--agent` and `--scope project|user` flags
4. Record what was written so `uninstall` can reverse exactly that
