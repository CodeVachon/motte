---
id: 67
title: Code health follow-ups
state: In Progress
labels: [health]
created: 2026-07-30T14:39:51Z
updated: 2026-08-04T21:27:23Z
---

## Description

Findings from a fallow pass over the codebase, none of which change behaviour. Grouped so they surface as active work rather than hanging off epics that are already complete.

Health score at the time of filing: 77.7 (B). The two largest penalties were unit size and hotspots; dead code and duplication were minor.

## Plan

1. #0064 split createMotteServer
2. #0065 reduce complexity in the doctor handler
3. #0066 dead exports and CLI duplication

None of these block the web UI. #0040 does, and it is tracked under #0003.

## Notes

### 2026-07-30T18:04:48Z — claude (agent)

Epic complete: #0064 split createMotteServer, #0065 split the doctor handler, #0066 dead code and
duplication. #0069, #0072 and #0073 also landed under this epic along the way.

Where the numbers ended up, stated plainly because the headline score barely moved: 77.9 (B) against 77.7
when this was filed. The remaining penalties are hotspots 10.0 and unit_size 10.0, and neither of those is
what the three children targeted.

What did change is real, though:

Dead code went from ten findings to zero, across every category fallow checks.

doctor.ts left the complexity findings entirely — it was the only function in the project over all three
thresholds — and is now at 100% statements with 21 unit tests for checks that previously could only be
reached by building a broken backlog in a temp directory.

server.ts went from 640 lines to 57, with the twelve tools in three modules and the shared helpers stated as
an interface rather than implied by closure scope.

Why the score did not move: unit_size is measured per function, and the tool-registration functions are
still 133 to 195 lines each, because registering five tools is long even when it is the only thing the
function does. Data-driven registration would fix that, and I recorded the idea on #0064 rather than doing a
second refactor of the same code for a metric. The hotspot penalty is churn times complexity over six
months, so on a project that is a day old it mostly reflects that IssueStore and index.ts are where the work
has been.

Left open under this epic: #0074, the deps/reads filter duplication.

If the goal is an A, the honest next lever is neither of these children — it is prune.ts and upgrade.ts,
which hold the four highest CRAP scores in the project at 420, 182, 110 and 110, all at 0% coverage. That is
a testing gap, not a structural one.

### 2026-08-04T21:27:23Z — claude (agent)

Reopened rather than detaching #0074. This epic exists to hold the follow-ups from the health audit, and #0074 is one — so the truthful state is that it still has open work, not that it is done and something unrelated happens to point at it. Closes when #0074 lands.
