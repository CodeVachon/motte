---
id: 79
title: Automated tests for the web views
state: Done
parent: 6
labels: [web, testing]
created: 2026-08-04T16:41:34Z
updated: 2026-08-04T17:59:51Z
---

## Description

The four views have no automated tests. Their only verification is a Playwright pass I drove by hand, which is not in CI and will not run again unless someone remembers to.

fallow reports eight CRAP findings across apps/web, and every one of them is the same fact: cyclomatic complexity of 5 to 9, which is fine, multiplied by zero coverage. Splitting components further will not move it — only tests will.

This is the same gap the CLI had before #0073, and it matters more here than for a static page: these views write to committed files, and drag-to-move is one mistaken drop away from changing an issue nobody meant to touch.

## Plan

1. jsdom and @testing-library/react, so components render in vitest
2. Cover what the manual pass covered: a card's blocked badge, the board grouping by configured state, the tree's build and its orphan case, the reports rollup rendering, and the detail form saving on blur
3. Cover what the manual pass could not easily reach: a refused write leaving the field's text alone, and an error banner appearing with the server's message
4. Decide whether the Playwright pass itself should run in CI, or stay a release-time check — a headless browser in every CI run is a real cost

## Notes

### 2026-08-04T17:59:51Z — claude (agent)

Done. 44 tests across the four views, the card, the shell and the fixtures, and all eight of fallow's
apps/web findings are gone — confirmed by reading the findings rather than assuming, since every one of them
was zero coverage multiplied by modest complexity.

The views take a Backlog and nothing else, so they render against a hand-built one with no server, no fetch
and no timers. That was the payoff of putting all the fetching in one hook: everything downstream is a
function from data to markup. Only App.test.tsx goes through useBacklog, because the loading state, the error
banner and the routing are the wiring nothing else covers.

Both cases the manual pass could not reach are now covered. A refused write leaves the user's text in the
field — losing an edit over a rule they can still act on would be the worst outcome available — and a refused
note leaves the draft in the composer, which is the one thing here a user cannot retrieve. And the error
banner shows the server's own words.

Drag and drop is exercised by firing the events the browser fires, then asserting on the request that came
out: card id and target state together, not merely that something was called. That is not a pointer gesture,
which is what Playwright is for, but it is exactly the contract the handlers are written against.

Two things I got wrong on the way.

vitest did not pick the files up at all at first: the include patterns matched .test.ts and these are .test.tsx.
Silent — no error, just no tests.

And every async test warned that state updates were happening outside act(). The cause was vi.waitFor rather
than testing-library's waitFor; only the latter wraps its polling in act(). Sixteen warnings, which I fixed
rather than tolerated, because a suite that prints noise is a suite where the next real warning goes unread.

Step 4 of the plan asked whether the Playwright pass should run in CI. Decided no, and recorded in AGENTS.md.
The component tests now cover what it covered plus two cases it could not, and the release workflow already
runs the compiled binary end to end on both Linux and Windows. A headless browser in every CI run means a
large download and a new flake surface, and #0072 was enough of that. It stays a pre-release check for the
things components cannot judge: real drag gestures, layout, whether it looks right.
