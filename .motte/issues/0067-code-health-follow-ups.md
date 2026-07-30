---
id: 67
title: Code health follow-ups
state: In Progress
labels: [health]
created: 2026-07-30T14:39:51Z
updated: 2026-07-30T17:46:25Z
---

## Description

Findings from a fallow pass over the codebase, none of which change behaviour. Grouped so they surface as active work rather than hanging off epics that are already complete.

Health score at the time of filing: 77.7 (B). The two largest penalties were unit size and hotspots; dead code and duplication were minor.

## Plan

1. #0064 split createMotteServer
2. #0065 reduce complexity in the doctor handler
3. #0066 dead exports and CLI duplication

None of these block the web UI. #0040 does, and it is tracked under #0003.
