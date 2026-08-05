---
id: 95
title: Enforced state transitions
state: Cancelled
labels: [core]
created: 2026-08-05T15:50:27Z
updated: 2026-08-05T15:50:27Z
---

## Description

Validate that a state change follows an allowed path — no jumping Todo straight to Done, no reopening cancelled work without a reason.

## Notes

### 2026-08-05T15:50:27Z — claude (agent)

Declined deliberately. States are user-configurable by design: the config names them and gives each a category, and that is the whole model. A transition table turns that into a workflow engine, which is the thing people leave Jira to escape. `doctor` already reports the inconsistencies that actually mislead — a state not in the config, a parent that disagrees with its subtree, work started while blocked — without forbidding anything.
