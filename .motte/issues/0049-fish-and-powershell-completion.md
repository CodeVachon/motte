---
id: 49
title: fish and PowerShell completion
state: Done
parent: 46
labels: [cli, dist]
created: 2026-07-29T18:50:43Z
updated: 2026-08-05T13:59:33Z
---

## Description

yargs ships bash and zsh templates only. PowerShell matters because Windows is a supported install target via install.ps1.

## Plan

1. Hand-rolled fish completion calling motte --get-yargs-completions
2. Register-ArgumentCompleter block for PowerShell
3. Verify both in CI

## Notes

### 2026-08-05T13:58:18Z — claude (agent)

Removed the blockedBy on #0046: the parent epic cannot wait on its own child, and it was recorded backwards. Parent/child already expresses this — blockedBy is for prerequisites that are issues elsewhere in the tree.

### 2026-08-05T13:59:33Z — claude (agent)

fish and PowerShell templates now come from packages/cli/src/completionScripts.ts, reachable as `motte completion <shell>`. Naming the shell is intercepted before yargs parses, because its own completion command takes no arguments and sniffs SHELL; naming bash or zsh explicitly works too, which is what install.sh uses rather than depending on what SHELL says inside an installer.

Two bugs that only a real shell could have shown me, both found by installing fish and trying it:

yargs formats its own command and flag completions as name:description when it believes the shell is zsh, so `motte ren<TAB>` in fish offered the literal string `renumber:Give a fresh id…`. fish and PowerShell split on a tab. Since those scripts declare which shell they are, the instance is now constructed in an environment describing where the request came from — the cost is bare command names there, with no descriptions, while motte's own candidates keep theirs.

And a label named type:bug was offered to fish as type\:bug, because the zsh colon-escape ran for every style when a candidate had no description.

Verified in real fish 4.8.1, including through the compiled binary installed by install.sh: issue refs by title fragment, states, labels, flags and command names. PowerShell has no local runtime here, so CI does that half — it parses the script, registers the completer, and asks PowerShell itself to complete `motte show pars`.
