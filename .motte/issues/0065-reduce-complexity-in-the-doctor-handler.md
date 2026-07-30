---
id: 65
title: Reduce complexity in the doctor handler
state: Todo
parent: 67
labels: [cli, health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T14:39:52Z
---

## Description

The doctor handler is cyclomatic 31, cognitive 44, 155 lines — the worst single function in the project on every complexity measure, and the highest CRAP at 992.

It accumulates seven independent check families inline. Each is simple; the total is not.

## Plan

1. One function per check family, each returning Problem[]
2. The handler becomes: run the checks, group by severity, render
3. That also makes the checks unit-testable without spawning the CLI, which is what the 992 is really about
