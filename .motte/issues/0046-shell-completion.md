---
id: 46
title: Shell completion
state: Todo
labels: [cli, dx]
created: 2026-07-29T18:50:42Z
updated: 2026-08-04T17:36:23Z
---

## Description

Tab-completion for motte across bash, zsh, fish and PowerShell.

Static completion of commands and flags is table stakes. The reason this is worth real effort is dynamic completion of issue references by title fragment — resolveRef already accepts a fragment or an id, so `motte show log<TAB>` completing to the login issue is the feature that makes the whole reference model pleasant instead of merely clever.

## Plan

1. Frontmatter-only reader in core (#0047) — the latency prerequisite
2. motte completion for bash and zsh from the yargs templates
3. Dynamic sources: issue refs, states, assignees, labels
4. fish and PowerShell templates, which yargs does not provide
5. Wire into install.sh, and remove in motte uninstall

## Notes

### 2026-07-29T18:50:43Z — claude (agent)

Measured before planning. Frontmatter-only versus full parse: 45 issues 5ms vs 27ms (5.2x), 500 issues 32ms vs 53ms, 2,000 issues 113ms vs 143ms — the advantage narrows at scale because file I/O starts to dominate.

At 2,000 issues a completion round trip lands near 150ms and begins to drag. That is the honest trigger for reopening #0044, the SQLite index I declined: tab-completion is the one workload that justifies a cache, because it is latency-sensitive and runs constantly. Nothing else in the tool is.

### 2026-08-04T17:36:23Z — claude (agent)

Status check: bash and zsh completion is done and working — `motte completion` emits the script, dynamic sources landed in #0048, and the latency prerequisite in #0047. What keeps this open is #0049, the fish and PowerShell templates yargs does not provide, plus wiring the script into install.sh and removing it in uninstall. Worth knowing before anyone picks this up expecting to start from nothing.
