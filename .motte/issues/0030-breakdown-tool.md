---
id: 30
title: breakdown tool
state: Todo
parent: 5
labels: [mcp, agents]
created: 2026-07-29T11:52:00Z
updated: 2026-07-29T11:52:00Z
---

## Description

Create many child issues under one parent in a single call, so an agent can decompose an epic
without a round trip per child.

This is the tool that most directly serves the project's purpose: take a larger story and break it
into smaller trackable components.

## Plan

1. Accept a parent ref and an array of `{ title, description?, plan? }`
2. Allocate ids in one pass to avoid collisions within the batch
3. Return the created issues, and the parent's updated subtree progress
