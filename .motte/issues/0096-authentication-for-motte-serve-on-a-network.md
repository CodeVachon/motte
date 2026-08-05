---
id: 96
title: Authentication for motte serve on a network
state: Cancelled
labels: [web]
created: 2026-08-05T15:50:27Z
updated: 2026-08-05T15:50:28Z
---

## Description

Bind beyond loopback and add authentication, so the web UI can be reached from another machine.

## Notes

### 2026-08-05T15:50:27Z — claude (agent)

Declined. Loopback-only with a Host check is not a limitation to be lifted; it is what makes a no-auth server defensible. The moment it listens on a network it needs accounts, sessions and a threat model, and that is a different product from a local tool reading a local directory. Anyone who wants remote access already has ssh port-forwarding, which is both safer and somebody else's problem to maintain.
