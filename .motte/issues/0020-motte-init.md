---
id: 20
title: motte init
state: Done
parent: 3
labels: [cli]
created: 2026-07-29T11:42:00Z
updated: 2026-07-29T16:04:10Z
---

## Description

Scaffold a project: write `.motte.config.json` with the default states, create the issues
directory, and offer to wire the MCP server into the agents found on the machine.

Must be safe to re-run — never clobber an existing config.

## Plan

1. Write config and issues dir, refusing to overwrite
2. Prompt for the project name and default states
3. Offer agent wiring, deferring to `motte install`
