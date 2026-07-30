import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    buildTree,
    subtreeOf,
    epicReports,
    openBlockers,
    projectReport,
    ready,
    subtreeReport,
    type Issue,
    type TreeNode
} from "@motte/core";
import type { ToolContext } from "../toolContext.js";
import { fullIssueJson, issueJson, text } from "../shape.js";

/** The read-only tools. `ready_issues` comes first because it is the one an agent should reach for. */
export function registerReadTools(server: McpServer, tools: ToolContext): void {
    const { open, guard } = tools;

    server.registerTool(
        "ready_issues",
        {
            title: "Ready issues",
            description:
                "Issues that can be picked up right now: not yet settled, with every blocker settled. " +
                "Start here rather than with list_issues.",
            inputSchema: {
                label: z.string().optional().describe("Only issues carrying this label"),
                assignee: z.string().optional().describe("Only issues assigned to this person")
            },
            annotations: { readOnlyHint: true }
        },
        guard((args: { label?: string; assignee?: string }) => {
            const { config, store } = open();
            const issues = store.all();
            let selected = ready(config, issues);

            if (args.label !== undefined) {
                const needle = args.label.toLowerCase();
                selected = selected.filter((issue) =>
                    (issue.labels ?? []).some((label) => label.toLowerCase() === needle)
                );
            }
            if (args.assignee !== undefined) {
                const needle = args.assignee.toLowerCase();
                selected = selected.filter((issue) => issue.assignee?.toLowerCase() === needle);
            }

            return text({
                count: selected.length,
                issues: selected.map((issue) => issueJson(config, issues, issue))
            });
        })
    );

    server.registerTool(
        "list_issues",
        {
            title: "List issues",
            description:
                "All issues, optionally filtered. Prefer ready_issues when choosing what to work on.",
            inputSchema: {
                state: z.string().optional().describe("Exact state name"),
                label: z.string().optional(),
                assignee: z.string().optional(),
                parent: z.number().int().optional().describe("Only children of this issue id"),
                blocked: z.boolean().optional().describe("Only issues waiting on an open blocker")
            },
            annotations: { readOnlyHint: true }
        },
        guard(
            (args: {
                state?: string;
                label?: string;
                assignee?: string;
                parent?: number;
                blocked?: boolean;
            }) => {
                const { config, store } = open();
                const issues = store.all();
                let selected = issues;

                if (args.state !== undefined) {
                    const needle = args.state.toLowerCase();
                    selected = selected.filter((issue) => issue.state.toLowerCase() === needle);
                }
                if (args.label !== undefined) {
                    const needle = args.label.toLowerCase();
                    selected = selected.filter((issue) =>
                        (issue.labels ?? []).some((label) => label.toLowerCase() === needle)
                    );
                }
                if (args.assignee !== undefined) {
                    const needle = args.assignee.toLowerCase();
                    selected = selected.filter((issue) => issue.assignee?.toLowerCase() === needle);
                }
                if (args.parent !== undefined) {
                    selected = selected.filter((issue) => issue.parent === args.parent);
                }
                if (args.blocked === true) {
                    selected = selected.filter(
                        (issue) => openBlockers(config, issues, issue).length > 0
                    );
                }

                return text({
                    count: selected.length,
                    states: config.states.map((state) => state.name),
                    issues: selected.map((issue) => issueJson(config, issues, issue))
                });
            }
        )
    );

    server.registerTool(
        "get_issue",
        {
            title: "Get an issue",
            description:
                "One issue in full, including its description, plan, notes and children. " +
                "`ref` accepts an issue number or part of its title.",
            inputSchema: { ref: z.union([z.number().int(), z.string()]) },
            annotations: { readOnlyHint: true }
        },
        guard((args: { ref: number | string }) => {
            const { config, store } = open();
            const issues = store.all();
            const issue = store.resolve(args.ref);

            return text({
                ...fullIssueJson(config, issues, issue),
                progress: issues.some((candidate) => candidate.parent === issue.id)
                    ? subtreeReport(config, issues, issue.id)
                    : null
            });
        })
    );

    server.registerTool(
        "tree",
        {
            title: "Issue hierarchy",
            description: "The parent/child forest, or one issue's subtree.",
            inputSchema: { ref: z.union([z.number().int(), z.string()]).optional() },
            annotations: { readOnlyHint: true }
        },
        guard((args: { ref?: number | string }) => {
            const { config, store } = open();
            const issues = store.all();
            const { roots, problems } = buildTree(issues);

            const serialize = (node: TreeNode): unknown => ({
                id: node.issue.id,
                title: node.issue.title,
                state: node.issue.state,
                children: node.children.map(serialize)
            });

            const scope =
                args.ref === undefined ? roots : subtreeOf(roots, store.resolve(args.ref).id);

            return text({
                roots: scope.map(serialize),
                problems: problems.map((problem) => problem.message)
            });
        })
    );

    server.registerTool(
        "status_report",
        {
            title: "Project status",
            description: "Progress for the project and for each issue that has children.",
            inputSchema: {},
            annotations: { readOnlyHint: true }
        },
        guard(() => {
            const { config, store } = open();
            const issues = store.all();
            const report = projectReport(config, issues);

            return text({
                name: report.name,
                percentComplete: report.percentComplete,
                total: report.total,
                completed: report.completed,
                started: report.started,
                unstarted: report.unstarted,
                cancelled: report.cancelled,
                readyCount: ready(config, issues).length,
                byState: report.byState,
                inProgress: report.inProgress.map((issue) => issueJson(config, issues, issue)),
                epics: epicReports(config, issues).map((epic) => ({
                    id: epic.issue.id,
                    title: epic.issue.title,
                    percentComplete: epic.percentComplete,
                    completed: epic.completed,
                    total: epic.total
                }))
            });
        })
    );
}
