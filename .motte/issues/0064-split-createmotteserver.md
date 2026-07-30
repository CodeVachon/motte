---
id: 64
title: Split createMotteServer
state: Done
parent: 67
labels: [mcp, health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T17:55:49Z
---

## Description

createMotteServer is 525 lines — by a wide margin the largest function in the project. It registers twelve tools in one body, so every tool's schema, guard and handler shares one scope.

Found by fallow's unit-size analysis, which is one of the two largest penalties on the project health score.

## Plan

1. One module per tool group: reads, writes, breakdown
2. Keep the shared helpers (guard, open, author, issueJson) in one place they can all import
3. createMotteServer becomes registration only
4. The existing 26 server tests should pass untouched — if they need changing, the split changed behaviour

## Notes

### 2026-07-30T17:55:49Z — claude (agent)

Done, with one honest caveat about what it did and did not buy.

server.ts went from 640 lines to 57, and createMotteServer is now registration only. Five modules:
shape.ts (ToolResult, text, failure, issueJson, fullIssueJson), toolContext.ts (open, author, guard),
and tools/{reads,writes,breakdown}.ts.

The reason that function had grown to 525 lines is worth naming, because it was structural rather than
carelessness: open, author and guard were closures over the server instance and the resolved cwd, so every
tool had to live in the same scope to see them. Making them an explicit ToolContext is what let the tools
move out at all.

The plan's own success criterion was that the 30 server tests pass untouched, and they do — I moved the
registration blocks verbatim by line range rather than retyping them, precisely so that if behaviour had
changed the tests would say so. git diff on server.test.ts is empty.

The caveat: the project health score is 77.9, against 77.7 when this was filed. Essentially unchanged, and
the unit_size penalty of 10.0 has not moved at all. createMotteServer is gone from the large-function list,
but registerReadTools is 195 lines, registerWriteTools 152 and registerBreakdownTool 133 — all still over
the 60-line threshold, because a function that registers five tools is long even when registering is the
only thing it does. Each registerTool call is roughly 30 lines of schema plus handler.

So the win here is navigability, not the metric. A 640-line file is now five files whose names say what is
in them, and the shared helpers are stated as an interface rather than implied by scope. If we want the
unit_size penalty to actually move, the shape would be data-driven registration — an array of {name,
config, handler} per group with a loop — which puts every handler under the threshold. Filing that thought
here rather than doing it now: it is a second refactor of the same code for a score, and I would rather see
whether the current structure reads well first.
