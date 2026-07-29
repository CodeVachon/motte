---
id: 10
title: AGENTS.md, ReadMe, and LICENSE
state: Done
parent: 1
labels: [infra, docs]
created: 2026-07-29T11:32:00Z
updated: 2026-07-29T16:04:08Z
---

## Description

Project-level documentation and the agent contract. `AGENTS.md` lists the mandatory pre-completion
checks and states the dogfooding rule: track work in motte, not in ad-hoc TODOs.

`.gitignore` must not ignore `.motte/` — the backlog is the product of the tool and has to be
committed.

## Plan

1. `AGENTS.md` with the check list and the dogfooding rule
2. `ReadMe.md` with the install one-liner and a command tour
3. MIT `LICENSE`
4. `.gitignore` covering `node_modules`, `dist`, `bin`, `.vitest`, and generated web assets
