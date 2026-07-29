---
id: 47
title: Frontmatter-only reader for latency-sensitive reads
state: Done
parent: 46
labels: [core, perf]
created: 2026-07-29T18:50:43Z
updated: 2026-07-29T19:41:56Z
---

## Description

Completion fires on every TAB and needs nothing from the issue body, so it must not pay for the body tokenizer and note parser.

A reader that stops at the closing frontmatter fence is 5.2x faster at this repo's size (5ms vs 27ms for 45 issues). Combined with roughly 40ms of binary startup that puts a completion round trip near 45ms, under the threshold where lag is felt.

## Plan

1. parseFrontmatterOnly(text) in core, sharing the zod schema with the full parser
2. IssueStore.refs() returning id, title, state, assignee and labels only
3. Benchmark guard so a regression here is visible
4. Reuse anywhere else that only needs the header

## Notes

### 2026-07-29T19:41:56Z — claude (agent)

Done. parseFrontmatter and readFrontmatter in core, plus IssueStore.refs() returning headers with the file path.

Measured on this machine, refs() versus all(): 53 issues 12ms vs 37ms (3.1x), 500 issues 34ms vs 75ms (2.2x), 2,000 issues 129ms vs 212ms (1.6x), 10,000 issues 601ms vs 955ms (1.6x). Combined with roughly 40ms of binary startup, a completion round trip on a normal backlog lands near 50ms, under the threshold where lag is felt. That was the goal.

Correction to my own reasoning on this issue: I claimed the win came from reading a bounded chunk instead of the whole file. Measured in isolation, that is not where it comes from. At realistic body sizes the bounded read is worth about 1.1x — noise. It only pays at very large bodies: 2,000 files with 50KB bodies gave 1.11x, but 500 files with 500KB bodies gave 3.06x. The actual gain in refs() comes from skipping the body tokenizer, the section splitter and the note parser.

Kept the bounded read anyway. It is correct, it has a whole-file fallback for headers longer than one chunk, and it guarantees cost is independent of body size, which matters for a path that fires on every keystroke as notes accumulate over a project's life. But it is not load-bearing, and nobody should treat it as such.

### 2026-07-29T19:41:56Z — claude (agent)

Two deviations from the plan on this issue.

Plan item 3 asked for a benchmark guard. A timing assertion in the suite would be flaky on shared CI, so the guard is structural instead: parseFrontmatter is tested against a body that parseIssueFile rejects. That test cannot pass if body parsing is ever reintroduced on this path, and it does not depend on how fast the machine is.

Plan item 4 asked to reuse this anywhere else that only needs the header. Nothing currently qualifies. status, tree and list all render a note count via issueLine, so they genuinely need the bodies, and none of them is latency-sensitive at 37ms. Completion is the only caller that wants headers only, and that is #0048. Deferring rather than forcing a reuse that would change visible output.
