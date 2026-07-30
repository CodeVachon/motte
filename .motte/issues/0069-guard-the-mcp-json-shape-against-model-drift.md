---
id: 69
title: Guard the MCP JSON shape against model drift
state: Done
parent: 67
labels: [cli, testing, mcp]
created: 2026-07-30T15:03:34Z
updated: 2026-07-30T17:32:45Z
---

## Description

The CLI's --json contract now has a mechanical completeness guard (context.test.ts asserts every FrontmatterSchema field appears in the output). The MCP server's issueJson in mcp/server.ts does not, and it is the other half of the duplication that let blockedBy go missing from the CLI surface for several commits.

The two shapes cannot simply be merged: MCP adds openBlockers and children, and flattens note authorship into author/authorType. But both should fail loudly when a field joins the issue model and not the surface.

## Plan

1. Add the FrontmatterSchema.shape completeness assertion to mcp/server.test.ts, against issueJson and fullIssueJson
2. Pin both key sets, as context.test.ts does
3. Verify by mutation — remove a field and confirm the test names it — not by the test merely passing
4. Consider whether the shared subset is worth extracting to one place, or whether the deliberate divergence makes two guarded duplicates the honest answer

## Notes

### 2026-07-30T17:32:45Z — claude (agent)

Done. Both JSON surfaces now carry the same model-completeness guard.

Asserted through real tool calls over the in-memory transport rather than by exporting issueJson, so what
is pinned is the response an agent actually receives, not an internal helper. That also meant no new export
existing solely for a test.

Four tests. The first walks FrontmatterSchema.shape and requires every field to appear in both get_issue and
list_issues — the check that would have caught the original drift at the moment blockedBy was added to the
model. The next two pin the trimmed and full key sets. The fourth writes the divergence down explicitly:
MCP adds openBlockers, children and progress; the CLI adds file. If that list changes it should be because
someone decided to change it, not by accident.

Decided against merging the two shapes, which #0066's plan had floated. They differ for good reasons —
openBlockers answers "can I pick this up", which blockedBy alone does not, and an agent has no use for a
file path — so two guarded duplicates is the honest arrangement rather than one shape with conditional
fields.

Verified by mutation rather than by a green run. Removing blockedBy from the MCP shape fails with
"blockedBy is missing from get_issue" and the same for list_issues; removing openBlockers trips both pinned
key sets and the divergence test. Restored and confirmed byte-identical afterwards.
