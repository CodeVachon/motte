---
id: 81
title: Three tests failed twice under load and I could not identify them
state: Todo
labels: [testing, bug]
created: 2026-08-04T21:26:22Z
updated: 2026-08-04T21:27:23Z
---

## Description

During the 0.4.x work the suite twice reported 3 failures out of ~760, and both times three clean re-runs passed. Both occurrences were while a Playwright-driven Chromium, a Vite dev server and a motte serve were running, so CPU contention against the spawn-bounded CLI tests is the likely cause — but that is a guess: I did not capture which tests failed, because the summary line was grepped rather than the whole run kept.

## Plan

1. Keep the full output of every local run (tee to a file) so the next occurrence names the tests
2. If it is the spawn bound, the failures will be in the spawn-based CLI tests — those already retry twice, so a reported failure means three attempts exceeded the bound, which argues for a longer bound rather than more retries
3. CI runs --reporter=verbose, so a recurrence there names the last test to complete
4. Close as not-reproducible if it does not recur once someone is looking
