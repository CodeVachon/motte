---
id: 79
title: Automated tests for the web views
state: Todo
parent: 6
labels: [web, testing]
created: 2026-08-04T16:41:34Z
updated: 2026-08-04T16:41:34Z
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
