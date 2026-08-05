---
id: 91
title: watch --all, across every registered project
state: Todo
labels: [cli, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T15:49:58Z
---

## Description

The dashboard watches one project. The registry now knows about all of them, and the case that motivated watching — several agents at once — is exactly the case where they are working in more than one repository.

## Plan

1. Watch every registered project, dropping the ones that cannot be read
2. Each change line names its project
3. The pinned summary becomes the cross-project total, per project underneath
4. Bound the watchers: a machine with forty registered projects should not open forty watches without saying so
