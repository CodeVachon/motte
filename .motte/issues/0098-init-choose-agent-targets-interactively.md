---
id: 98
title: "init: choose agent targets interactively"
state: In Progress
labels: [cli, agents]
created: 2026-08-26T16:09:18Z
updated: 2026-08-26T17:55:08Z
---

## Description

motte init currently detects every supported agent and immediately writes its wiring. Let a person at a terminal choose which agent integrations to install, including Claude Code, Codex CLI, Cursor, Gemini CLI, and opencode, instead of treating detection as consent. Keep the shared AGENTS.md guidance deliberate and explain any targets that cannot be selected because their configuration is unavailable.

Non-interactive runs must remain deterministic: scripts, CI, pipes, and existing --no-agents behaviour cannot block on a prompt.

## Plan

1. Export selection-safe metadata from the existing agent target descriptors — id, label, detection result, and scope/file caveat — so prompt choices and wiring cannot drift.
2. Add @clack/prompts as the TTY-only multi-select UI for init. Preselect detected targets, permit an empty selection and cancellation, and only prompt when both stdin and stdout are interactive; retain current detected-agent wiring for non-interactive runs.
3. Thread an explicit selected-target set through the shared wiring planner so init applies only the selected integrations and writes AGENTS.md once when agent setup is enabled.
4. Add a repeatable init --agent selector, with target validation and clear interaction with --no-agents, so CI, scripts, and pipes can make the same selection without a prompt.
5. Cover descriptor metadata, explicit multiple targets, TTY selection/cancellation, non-TTY compatibility, nested init roots, and existing-config safety; update init and install documentation with supported targets and defaults.

## Notes

### 2026-08-26T17:55:08Z — codex (agent)

Used @clack/prompts behind a both-streams-TTY gate. In a pipe or test harness init keeps its detected-agent default; an empty selection still writes AGENTS.md, while cancellation writes no agent files so Ctrl-C never reads as consent.
