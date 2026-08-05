---
id: 81
title: Three tests failed twice under load and I could not identify them
state: Done
labels: [testing, bug]
created: 2026-08-04T21:26:22Z
updated: 2026-08-05T14:16:05Z
---

## Description

During the 0.4.x work the suite twice reported 3 failures out of ~760, and both times three clean re-runs passed. Both occurrences were while a Playwright-driven Chromium, a Vite dev server and a motte serve were running, so CPU contention against the spawn-bounded CLI tests is the likely cause — but that is a guess: I did not capture which tests failed, because the summary line was grepped rather than the whole run kept.

## Plan

1. Keep the full output of every local run (tee to a file) so the next occurrence names the tests
2. If it is the spawn bound, the failures will be in the spawn-based CLI tests — those already retry twice, so a reported failure means three attempts exceeded the bound, which argues for a longer bound rather than more retries
3. CI runs --reporter=verbose, so a recurrence there names the last test to complete
4. Close as not-reproducible if it does not recur once someone is looking

## Notes

### 2026-08-05T14:13:29Z — claude (agent)

probe, ignore

### 2026-08-05T14:16:04Z — claude (agent)

Caught and diagnosed. The three tests were always the same three, all about note authorship: 'notes > attributes a note to the connecting client by name' in the MCP suite, 'the JSON API over HTTP > attributes a write from the web to the same person the CLI would', and 'the everyday sequence > records a note with its author'.

The cause was not load or timing, which is what I had guessed twice. It was MOTTE_AGENT exported in my own shell: resolveAuthor prefers it over the git user and over the connecting MCP client, so every note came out authored by 'claude (agent)' and the three tests asserting otherwise failed. It only appeared in runs where I had exported the variable to make my own motte writes in the same command — which is why it looked random, and why CI never showed it: CI has neither variable set.

Fixed at the root with a vitest setup file that clears MOTTE_AGENT and MOTTE_AUTHOR before every test file, so no developer's environment can change what the suite asserts. Verified: the full suite now passes both with MOTTE_AGENT set and with it unset, where before it failed with it set.

Also worth noting for the plan's step 1: keeping the whole run rather than grepping the summary line is what finally identified it.
