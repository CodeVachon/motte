---
id: 92
title: "install: Cursor, Gemini CLI and opencode"
state: Todo
labels: [mcp, agents, dist]
created: 2026-08-05T15:49:59Z
updated: 2026-08-05T15:49:59Z
---

## Description

`motte install` detects Claude Code and the Codex CLI. `--print-config` is the escape hatch for everything else, which is not the same as supporting it: the value is in detecting what is present and merging into a config file without destroying what is there.

## Plan

1. One target descriptor per agent — where its config lives, and what shape motte's entry takes
2. Merge into each without clobbering, and record it for uninstall, as the existing two do
3. Tests against realistic files with other servers already configured, not empty ones
4. Say plainly in the ReadMe which are detected and which need --print-config
