---
id: 75
title: Test prune and restore
state: Done
parent: 3
labels: [cli, testing, core]
created: 2026-07-30T18:13:08Z
updated: 2026-07-30T18:19:30Z
---

## Description

prune.ts holds the two highest CRAP scores in the project — 420 and 110 — both at 0% coverage, and nothing tests either handler. That matters more here than anywhere else in the CLI: prune deletes committed files, and its safety guarantee is that a tombstone makes the deletion recoverable.

I verified that guarantee by hand while doing #0066, in a temp git repo, and then threw the setup away. It should be a test.

## Plan

1. A git-backed project helper — prune refuses to run in a dirty or non-git tree
2. The guarantee both ways: a real prune writes tombstones and restore returns the issue intact; --events-only keeps the issues and writes none, and restore refuses
3. The refusals: dirty repo, no cutoff, an unparseable cutoff, a bare number for --before
4. Selection: unsettled issues are never pruned, and a cancelled blocker counts as settled
5. Cover the restore failure paths too — unknown id, and an id with no tombstone

## Notes

### 2026-07-30T18:19:30Z — claude (agent)

Done. commands/prune.ts goes from 7% to 81.7% statements, 77.3% branches, 100% functions, and its two
handlers drop out of the CRAP findings.

15 tests, and the two that matter are the two halves of the safety guarantee. Verified by mutation rather
than by a green run, because a test that cannot fail is worse than no test here:

Commenting out the tombstone append in rewriteShards — which is prune silently becoming destructive — fails
four tests.

Making rewriteShardsEventsOnly write tombstones — which is #0066's warned-about merge, and would have
`motte restore` offering to bring back issues that were never removed and are still on disk — fails the
events-only test.

That retroactively covers the #0066 extraction, which I could only verify by hand at the time.

Also covered: the dry-run plan including the "referenced" skip reason with `as: "blocker"`, that a dry run
changes nothing on disk, the dirty-repo refusal naming the offending path (an earlier bug printed it with the
leading dot eaten), a missing and an unparseable cutoff, nothing-eligible, and the three restore failures —
never pruned, never existed, and already present.

One fixture mistake worth recording, since it is the same shape as several before it. My first
"refuses outside a git repository" test used an empty project and got exit 0. Not a bug: prune returns early
when nothing is eligible, so it never demands a repository it is not going to delete from. The test needed a
settled, backdated issue to reach the guard at all. Checking the handler's ordering took a minute; assuming
a product bug would have cost much longer.

Extracted the in-process harness from cli.test.ts to testing/cli.ts so this file could reuse it, and added
committedProject and commitAll there — prune refuses outside a repository, without commits, or with the
backlog dirty, so all three conditions have to be set up. That extraction immediately broke ENTRY, which
resolved relative to import.meta.dirname and so pointed at testing/index.ts; the wiring tests caught it.
