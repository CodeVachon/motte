---
id: 47
title: Frontmatter-only reader for latency-sensitive reads
state: Todo
parent: 46
labels: [core, perf]
created: 2026-07-29T18:50:43Z
updated: 2026-07-29T18:50:43Z
---

## Description

Completion fires on every TAB and needs nothing from the issue body, so it must not pay for the body tokenizer and note parser.

A reader that stops at the closing frontmatter fence is 5.2x faster at this repo's size (5ms vs 27ms for 45 issues). Combined with roughly 40ms of binary startup that puts a completion round trip near 45ms, under the threshold where lag is felt.

## Plan

1. parseFrontmatterOnly(text) in core, sharing the zod schema with the full parser
2. IssueStore.refs() returning id, title, state, assignee and labels only
3. Benchmark guard so a regression here is visible
4. Reuse anywhere else that only needs the header
