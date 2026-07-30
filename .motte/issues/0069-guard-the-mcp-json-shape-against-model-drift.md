---
id: 69
title: Guard the MCP JSON shape against model drift
state: Todo
parent: 67
labels: [cli,testing,mcp]
created: 2026-07-30T15:03:34Z
updated: 2026-07-30T15:03:34Z
---

## Description

The CLI's --json contract now has a mechanical completeness guard (context.test.ts asserts every FrontmatterSchema field appears in the output). The MCP server's issueJson in mcp/server.ts does not, and it is the other half of the duplication that let blockedBy go missing from the CLI surface for several commits.

The two shapes cannot simply be merged: MCP adds openBlockers and children, and flattens note authorship into author/authorType. But both should fail loudly when a field joins the issue model and not the surface.

## Plan

1. Add the FrontmatterSchema.shape completeness assertion to mcp/server.test.ts, against issueJson and fullIssueJson
2. Pin both key sets, as context.test.ts does
3. Verify by mutation — remove a field and confirm the test names it — not by the test merely passing
4. Consider whether the shared subset is worth extracting to one place, or whether the deliberate divergence makes two guarded duplicates the honest answer
