---
id: 92
title: "install: Cursor, Gemini CLI and opencode"
state: Done
assignee: claude
labels: [mcp, agents, dist]
created: 2026-08-05T15:49:59Z
updated: 2026-08-05T19:03:28Z
---

## Description

`motte install` detects Claude Code and the Codex CLI. `--print-config` is the escape hatch for everything else, which is not the same as supporting it: the value is in detecting what is present and merging into a config file without destroying what is there.

## Plan

1. One target descriptor per agent — where its config lives, and what shape motte's entry takes
2. Merge into each without clobbering, and record it for uninstall, as the existing two do
3. Tests against realistic files with other servers already configured, not empty ones
4. Say plainly in the ReadMe which are detected and which need --print-config

## Notes

### 2026-08-05T19:03:28Z — claude (agent)

--print-config remains the escape hatch, but three more agents are now detected and configured: Cursor, the Gemini CLI and opencode.

Cursor and Gemini take the same `mcpServers` shape as Claude Code's `.mcp.json`, so one writer serves all three — and Gemini keeps the rest of its settings in that same file, which is exactly why the merge preserves every other top-level key. opencode is the one that does not fit: servers under `mcp` rather than `mcpServers`, and the whole command line as one array with `type` and `enabled`. Every path and shape was checked against the vendors' own docs rather than recalled.

Two bugs came out of the change rather than the plan. `unwire` dispatched on the file extension, so `opencode.json` would have been treated as an `mcpServers` file — removing nothing and reporting success. It keys on the recorded agent now, which is the fact that actually determines the shape, and a mutation check confirms the tests catch it. And the closing advice hardcoded "Commit .mcp.json and AGENTS.md", which became wrong the moment other targets existed: installing for Cursor and opencode alone named a file that did not exist. It lists what was written.

Also: uninstall left `.cursor/` and `.gemini/` behind empty, since those are directories motte creates. It rmdirs them, which is self-limiting — a directory holding anything else survives.

planWiring's per-agent branching became a descriptor table, so a sixth target is data rather than another branch. fallow then caught the two JSON removers as a clone group; they are one function over a container key now.
