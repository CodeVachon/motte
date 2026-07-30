---
id: 48
title: Dynamic completion sources
state: Done
parent: 46
labels: [cli, dx]
blockedBy: [47]
created: 2026-07-29T18:50:43Z
updated: 2026-07-30T00:50:41Z
---

## Description

The completion values themselves, wired into yargs' completion hook.

## Plan

1. Issue refs — complete both the number and the title slug, since either resolves
2. Render zsh descriptions as `#0001 Build a login page [Todo]` via _describe
3. States from config for `move <ref> <TAB>`
4. Assignees observed in the backlog for `assign <ref> <TAB>`
5. Labels for --label

Completion must never write, and must never fail loudly — a broken backlog returns no candidates rather than spilling an error into the shell.

## Notes

### 2026-07-30T00:50:41Z — claude (agent)

Done. Dynamic completion for issue refs, states, assignees, labels and unblock targets, wired into
yargs' fallback completion form so command and flag names still come from yargs itself.

Verified against the real --get-yargs-completions protocol rather than unit tests alone: refs complete
to ids for a numeric or empty prefix and to slugs for an alphabetic one, states carry their category,
unblock offers only the blockers the target actually has, and outside a project it returns nothing
without a stack trace.

A design problem forced a core change. Completing to a slug would have inserted a value that did not
resolve — "reader-for-latency" is not a substring of "Frontmatter-only reader for latency-sensitive
reads", because the title has spaces where the slug has hyphens. The alternatives were ids only, which
breaks as soon as you type letters since shells filter by prefix, or full titles, which drags in shell
quoting and confuses zsh's _describe. So resolve() now matches slug forms too, in precision order:
exact title, exact slug, title substring, slug substring.

A bug was found only by end-to-end probing. The words were derived from yargs' parsed argv, which has
already consumed flags, so `list --label <TAB>` arrived with --label stripped and a flag-value position
was indistinguishable from a positional. Flag completion could never fire. Now read from process.argv,
with a test asserting --label survives precisely because the parsed argv would have eaten it.

Worth recording: 46 unit tests passed while the feature was broken, because they exercised the pure
function with hand-written word arrays rather than what yargs actually hands over.
