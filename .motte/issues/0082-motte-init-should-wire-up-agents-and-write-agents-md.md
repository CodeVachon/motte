---
id: 82
title: motte init should wire up agents and write AGENTS.md
state: Done
labels: [cli, agents]
created: 2026-08-05T12:36:45Z
updated: 2026-08-05T12:49:38Z
---

## Description

init writes the config and the issues directory, then only prints a hint to run `motte install`. #0020's plan said it would offer agent wiring and that never landed, so every new project needs two commands and nobody knows the second one exists until they read the output.

It should also leave instructions for the agents it just wired: an MCP server the agent can call is not the same as an agent that knows the loop — read the issue, refine the plan, move it to In Progress, add notes, move it to Done. AGENTS.md is where that belongs, and it is the file both Claude Code and the Codex CLI read.

## Plan

1. Share one implementation between init and install rather than duplicating detection: extract the targets, the actions and the apply step out of the install command handler
2. init wires every detected agent at project scope by default, with --no-agents to skip
3. Write a marked block into AGENTS.md — created if absent, appended if not — so it is idempotent and nothing outside the markers is ever touched
4. Record the AGENTS.md write like any other wiring, so uninstall --keep-cli removes exactly that block and deletes the file only if motte created it
5. install writes the block too, so a project created before this version gets it by running install
6. Tests: the merge and removal against a file with existing content and an existing block, plus init end to end in a temp project

## Notes

### 2026-08-05T12:49:38Z — claude (agent)

init now wires every detected agent and writes AGENTS.md, sharing one implementation with install rather than duplicating detection — the actions and the apply step moved to install/wiring.ts, and install is now flag parsing and output. --no-agents skips it on init, --no-instructions skips just the AGENTS.md block on install.

Two things the work turned up. planWiring found its project by walking up from the working directory, which is wrong for `motte init <dir>`: it would have wired whichever project the shell was sitting in. The root is passed explicitly now, and a test proves it by initialising a nested project from an unwired outer one.

And the test harness was about to start editing the home directory of whoever ran it — init writes ~/.codex/config.toml and the wiring record under ~/.motte. Both the in-process runner and spawnMotte now sandbox HOME, USERPROFILE and MOTTE_INSTALL_DIR into the temp project, and detection is forced with a helper rather than left to depend on whether claude happens to be on PATH, which would otherwise make the same test assert different things locally and in CI. Confirmed my own ~/.codex/config.toml and ~/.motte/installed-agents.json were untouched after a full run.

Verified by hand end to end in a sandboxed home: init wrote .mcp.json, ~/.codex/config.toml and AGENTS.md, and uninstall --keep-cli took motte's block out of an AGENTS.md that had the project's own content in it while leaving that content and an unrelated sentry MCP server alone — then deleted an AGENTS.md that motte itself had created.
