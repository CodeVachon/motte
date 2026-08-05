import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    buildTree,
    filterIssues,
    subtreeOf,
    epicReports,
    openBlockers,
    projectReport,
    rankReady,
    ready,
    searchIssues,
    subtreeReport,
    type Issue,
    type TreeNode
} from "@motte/core";
import type { ToolContext } from "../toolContext.js";
import { fullIssueJson, issueJson, text } from "../shape.js";

/** The read-only tools. `ready_issues` comes first because it is the one an agent should reach for. */
export function registerReadTools(server: McpServer, tools: ToolContext): void {
    const { open, guard } = tools;

    /**
     * Ordered, not just filtered.
     *
     * `ready_issues` hands back a set in id order, so an agent facing fifteen of them takes the lowest
     * number. This is the tool that answers "what should I do", and it says why — an agent can put the
     * reason in a note, which is how the choice stays inspectable later.
     */
    server.registerTool(
        "next_issue",
        {
            title: "Next issue",
            description:
                "The issue to pick up next, ordered by what it unblocks, how close it is to a leaf, and " +
                "how long it has waited. Work assigned to somebody else is left out. Prefer this over " +
                "ready_issues when choosing what to work on, then claim_issue before starting.",
            inputSchema: {
                limit: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("How many to return (default 1)"),
                mine: z.boolean().optional().describe("Only work already assigned to this agent")
            },
            annotations: { readOnlyHint: true }
        },
        guard((args: { limit?: number; mine?: boolean }) => {
            const { config, store } = open();
            const issues = store.all();

            const ranked = rankReady(config, issues, {
                assignee: tools.author().name,
                mineOnly: args.mine === true
            });

            return text({
                count: ranked.length,
                issues: ranked.slice(0, args.limit ?? 1).map((entry) => ({
                    ...issueJson(config, issues, entry.issue),
                    why: entry.reasons,
                    signals: entry.signals
                }))
            });
        })
    );

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

                // Exact state matching, unlike `motte list`: a caller here has the state name in hand
                // rather than typing a fragment, and widening it would change the tool's contract.
                selected = filterIssues(selected, {
                    state: args.state,
                    label: args.label,
                    assignee: args.assignee,
                    parent: args.parent
                });
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

    /**
     * Searching the bodies.
     *
     * The tool an agent needs before repeating work: the reasoning, and the dead ends, are in the notes, and
     * nothing else here can reach them.
     */
    server.registerTool(
        "search_issues",
        {
            title: "Search issues",
            description:
                "Search titles, descriptions, plans and note bodies for a phrase, case-insensitively. " +
                "Use this to find prior reasoning before deciding something that may already be decided.",
            inputSchema: {
                query: z.string().min(1).describe("The phrase to look for"),
                state: z.string().optional(),
                label: z.string().optional(),
                assignee: z.string().optional(),
                hits: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("Matching lines to return per issue (default 3)")
            },
            annotations: { readOnlyHint: true }
        },
        guard(
            (args: {
                query: string;
                state?: string;
                label?: string;
                assignee?: string;
                hits?: number;
            }) => {
                const { config, store } = open();
                const issues = store.all();

                const results = searchIssues(issues, args.query, {
                    filter: { state: args.state, label: args.label, assignee: args.assignee },
                    ...(args.hits === undefined ? {} : { maxHits: args.hits })
                });

                return text({
                    query: args.query,
                    count: results.length,
                    issues: results.map((result) => ({
                        ...issueJson(config, issues, result.issue),
                        hits: result.hits,
                        totalHits: result.total
                    }))
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
