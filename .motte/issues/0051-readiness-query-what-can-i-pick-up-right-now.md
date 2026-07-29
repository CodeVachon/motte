---
id: 51
title: Readiness query — what can I pick up right now
state: Todo
parent: 50
labels: [core, agents]
created: 2026-07-29T18:55:17Z
updated: 2026-07-29T18:55:17Z
---

## Description

The reason dependencies are worth adding. An issue is ready when it is not complete and every one of its blockers is complete.

`motte ready` answers the question an agent actually has at the start of a session, and it is the single most useful thing to expose over MCP. Without it an agent picks work by scanning titles and guessing at order.

## Plan

1. isReady(issue) in core, and a ready() query
2. motte ready, plus --ready on list
3. status reports N ready and M blocked, which is more actionable than raw state counts
4. A ready_issues MCP tool
