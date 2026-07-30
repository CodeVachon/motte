import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    ConfigNotFoundError,
    IssueStore,
    buildTree,
    epicReports,
    flattenTree,
    loadConfig,
    openBlockers,
    projectReport,
    ready,
    subtreeReport,
    type Config,
    type Issue,
    type TreeNode
} from "@motte/core";
import { VERSION } from "../version.js";

/**
 * How an agent is expected to use this. Sent to the client on initialize, so it shapes behaviour
 * before any tool is called.
 */
const INSTRUCTIONS = `motte tracks issues as committed Markdown files, so the record is shared with
whoever else works in this repository — including the humans.

Start with ready_issues, not list_issues. "Ready" means unsettled with every blocker settled; work that
is still blocked cannot be started, and picking it up anyway wastes effort.

For any issue you take on:

1. get_issue to read it, including its plan and prior notes
2. If the plan on the file is not what you are actually going to do, update_issue to correct it first
3. set_state to the started state
4. add_note as you go — decisions, dead ends, and anything the next person would otherwise have to
   rediscover. Notes are cheap and they are the main reason this record is worth keeping.
5. set_state to the completed state only once the work is actually verified

Use breakdown to split a large issue into children, rather than creating them one at a time.

If you discover that one issue depends on another, record it with set_blockers rather than describing
it in prose. Prose is not queryable, and ready_issues is what the next agent reads.

Notes you write are attributed to you as an agent. Notes written by a person through the CLI are
attributed to them. Both land in the same file.`;

const NO_PROJECT =
    "No motte project was found in this directory or any parent. " +
    "Run `motte init` in the project root, or start the server with --cwd pointing at it.";

interface ToolResult {
    // The SDK's callback return type carries an index signature for protocol extensions, so ours has
    // to as well or it is not assignable.
    [key: string]: unknown;
    content: { type: "text"; text: string }[];
    isError?: boolean;
}

function text(value: unknown): ToolResult {
    return {
        content: [
            {
                type: "text",
                text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
            }
        ]
    };
}

function failure(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

/** Trimmed issue shape. Sending unknownSections and file paths to an agent is noise. */
function issueJson(config: Config, issues: Issue[], issue: Issue) {
    return {
        id: issue.id,
        title: issue.title,
        state: issue.state,
        parent: issue.parent ?? null,
        assignee: issue.assignee ?? null,
        labels: issue.labels ?? [],
        blockedBy: issue.blockedBy ?? [],
        openBlockers: openBlockers(config, issues, issue).map((blocker) => blocker.id),
        created: issue.created,
        updated: issue.updated
    };
}

function fullIssueJson(config: Config, issues: Issue[], issue: Issue) {
    return {
        ...issueJson(config, issues, issue),
        description: issue.description,
        plan: issue.plan,
        notes: issue.notes.map((note) => ({
            at: note.at,
            author: note.author.name,
            authorType: note.author.type,
            body: note.body
        })),
        children: issues
            .filter((candidate) => candidate.parent === issue.id)
            .map((child) => ({ id: child.id, title: child.title, state: child.state }))
    };
}

export interface ServerOptions {
    /** Where to look for the project. Defaults to the process working directory. */
    cwd?: string;
    /** Overrides the agent name recorded on notes. */
    agent?: string;
}

export function createMotteServer(options: ServerOptions = {}): McpServer {
    const server = new McpServer(
        { name: "motte", version: VERSION },
        { instructions: INSTRUCTIONS }
    );

    const cwd = options.cwd ?? process.cwd();

    /**
     * The agent's identity, used both for authored notes and for recorded transitions.
     *
     * Prefers the client's own name from the MCP handshake, so notes say "claude-code" rather than a
     * generic label, and falls back to MOTTE_AGENT or an explicit override.
     */
    const agentName = (): string =>
        options.agent ??
        process.env.MOTTE_AGENT ??
        server.server.getClientVersion()?.name ??
        "agent";

    const author = () => ({ name: agentName(), type: "agent" as const });

    /**
     * Resolve the project per call rather than at startup.
     *
     * A server that fails to start shows up in the client as broken with no explanation. One that
     * starts and reports a missing project as a tool error tells the agent what to do about it.
     */
    const open = (): { config: Config; store: IssueStore } => {
        const config = loadConfig(cwd);
        // The author is handed to the store, not just used for notes, so recorded transitions are
        // attributed to the agent too — otherwise the log would credit every agent action to the
        // git user and the whole point of distinguishing them would be lost.
        return { config, store: new IssueStore(config, author()) };
    };

    /** Every tool body runs through here, so a missing project or a bad ref never crashes the server. */
    const guard =
        <A>(handler: (args: A) => ToolResult) =>
        (args: A): ToolResult => {
            try {
                return handler(args);
            } catch (thrown) {
                if (thrown instanceof ConfigNotFoundError) return failure(NO_PROJECT);
                return failure(thrown instanceof Error ? thrown.message : String(thrown));
            }
        };

    // ------------------------------------------------------------------ reading

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
                args.ref === undefined
                    ? roots
                    : (() => {
                          const target = store.resolve(args.ref);
                          const found = flattenTree(roots).find(
                              (node) => node.issue.id === target.id
                          );
                          return found === undefined ? [] : [found];
                      })();

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

    // ------------------------------------------------------------------ writing

    server.registerTool(
        "create_issue",
        {
            title: "Create an issue",
            description: "Create one issue. Use breakdown to create several children at once.",
            inputSchema: {
                title: z.string().min(1),
                description: z.string().optional(),
                plan: z.string().optional(),
                state: z.string().optional().describe("Defaults to the project's default state"),
                parent: z.number().int().optional(),
                assignee: z.string().optional(),
                labels: z.array(z.string()).optional(),
                blockedBy: z.array(z.number().int()).optional()
            }
        },
        guard(
            (args: {
                title: string;
                description?: string;
                plan?: string;
                state?: string;
                parent?: number;
                assignee?: string;
                labels?: string[];
                blockedBy?: number[];
            }) => {
                const { config, store } = open();
                const issue = store.create(args);
                return text({ created: issueJson(config, store.all(), issue) });
            }
        )
    );

    server.registerTool(
        "breakdown",
        {
            title: "Break an issue into children",
            description:
                "Split one issue into several children in a single call. This is the intended way to " +
                "decompose a large story or epic — creating children one at a time costs a round trip " +
                "each and tends to produce a shallower breakdown.",
            inputSchema: {
                parent: z
                    .union([z.number().int(), z.string()])
                    .describe("The issue being broken down"),
                children: z
                    .array(
                        z.object({
                            title: z.string().min(1),
                            description: z.string().optional(),
                            plan: z.string().optional(),
                            labels: z.array(z.string()).optional(),
                            assignee: z.string().optional(),
                            /**
                             * Positions within this batch, not issue ids — the ids do not exist yet.
                             * Lets a breakdown express its own internal ordering in one call.
                             */
                            blockedByIndex: z
                                .array(z.number().int().nonnegative())
                                .optional()
                                .describe(
                                    "Zero-based positions of earlier children in this same array that must finish first"
                                )
                        })
                    )
                    .min(1),
                inheritLabels: z
                    .boolean()
                    .optional()
                    .describe("Give each child the parent's labels as well (default true)")
            }
        },
        guard(
            (args: {
                parent: number | string;
                children: {
                    title: string;
                    description?: string;
                    plan?: string;
                    labels?: string[];
                    assignee?: string;
                    blockedByIndex?: number[];
                }[];
                inheritLabels?: boolean;
            }) => {
                const { config, store } = open();
                const parent = store.resolve(args.parent);

                // Validate the whole batch before writing anything, so a bad index cannot leave a
                // half-created breakdown behind.
                args.children.forEach((child, index) => {
                    for (const dependency of child.blockedByIndex ?? []) {
                        // Order matters: an index past the end is out of range, not merely "later",
                        // and saying so is the difference between a fixable message and a confusing one.
                        if (dependency === index) {
                            throw new Error(
                                `child ${index} ("${child.title}") lists itself as a dependency`
                            );
                        }
                        if (dependency >= args.children.length) {
                            throw new Error(
                                `child ${index} ("${child.title}") depends on position ${dependency}, ` +
                                    `but only ${args.children.length} children were given`
                            );
                        }
                        if (dependency > index) {
                            throw new Error(
                                `child ${index} ("${child.title}") depends on position ${dependency}, ` +
                                    `which comes later in the list — order the children so dependencies come first`
                            );
                        }
                    }
                });

                const inherit = args.inheritLabels !== false ? (parent.labels ?? []) : [];
                const created: Issue[] = [];

                for (const child of args.children) {
                    const labels = [...new Set([...(child.labels ?? []), ...inherit])];

                    created.push(
                        store.create({
                            title: child.title,
                            parent: parent.id,
                            ...(child.description === undefined
                                ? {}
                                : { description: child.description }),
                            ...(child.plan === undefined ? {} : { plan: child.plan }),
                            ...(child.assignee === undefined ? {} : { assignee: child.assignee }),
                            ...(labels.length === 0 ? {} : { labels })
                        })
                    );
                }

                // Dependencies are applied after creation, once every child has a real id.
                args.children.forEach((child, index) => {
                    const dependencies = child.blockedByIndex ?? [];
                    if (dependencies.length === 0) return;
                    store.update(created[index]!.id, {
                        blockedBy: dependencies.map((position) => created[position]!.id)
                    });
                });

                const issues = store.all();

                return text({
                    parent: { id: parent.id, title: parent.title },
                    created: created.map((issue) =>
                        issueJson(
                            config,
                            issues,
                            issues.find((i) => i.id === issue.id)!
                        )
                    ),
                    progress: subtreeReport(config, issues, parent.id),
                    ready: ready(config, issues)
                        .filter((issue) => created.some((child) => child.id === issue.id))
                        .map((issue) => issue.id)
                });
            }
        )
    );

    server.registerTool(
        "update_issue",
        {
            title: "Update an issue",
            description:
                "Change fields on an issue. Only the fields provided are touched. " +
                "Pass null for assignee or parent to clear it.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                title: z.string().optional(),
                description: z.string().optional(),
                plan: z.string().optional(),
                state: z.string().optional(),
                assignee: z.string().nullable().optional(),
                parent: z.number().int().nullable().optional(),
                labels: z.array(z.string()).optional()
            }
        },
        guard((args: { ref: number | string } & Record<string, unknown>) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const { ref: _ref, ...patch } = args;

            const issue = store.update(target.id, patch);
            return text({ updated: issueJson(config, store.all(), issue) });
        })
    );

    server.registerTool(
        "set_state",
        {
            title: "Set an issue's state",
            description:
                'Move an issue to a state. Matches case-insensitively and by prefix, so "done" works.',
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                state: z.string().min(1)
            }
        },
        guard((args: { ref: number | string; state: string }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.setState(target.id, args.state);

            return text({
                updated: issueJson(config, store.all(), issue),
                from: target.state,
                to: issue.state
            });
        })
    );

    server.registerTool(
        "set_parent",
        {
            title: "Set an issue's parent",
            description: "Re-parent an issue, or pass null to make it a root. Cycles are rejected.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                parent: z.number().int().nullable()
            }
        },
        guard((args: { ref: number | string; parent: number | null }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.setParent(target.id, args.parent);
            return text({ updated: issueJson(config, store.all(), issue) });
        })
    );

    server.registerTool(
        "set_blockers",
        {
            title: "Set what an issue waits on",
            description:
                "Replace the set of issues this one is blocked by. Pass an empty array to clear. " +
                "Record dependencies here rather than describing them in a plan — ready_issues reads this.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                blockedBy: z.array(z.number().int())
            }
        },
        guard((args: { ref: number | string; blockedBy: number[] }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.update(target.id, { blockedBy: args.blockedBy });
            return text({ updated: issueJson(config, store.all(), issue) });
        })
    );

    server.registerTool(
        "add_note",
        {
            title: "Add a note",
            description:
                "Append a note to an issue, attributed to you as an agent. Record decisions and dead " +
                "ends here — this is the main reason the record is worth keeping.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                body: z.string().min(1)
            }
        },
        guard((args: { ref: number | string; body: string }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.addNote(target.id, args.body, author());

            return text({
                noted: issueJson(config, store.all(), issue),
                author: author().name,
                noteCount: issue.notes.length
            });
        })
    );

    return server;
}

export { INSTRUCTIONS, NO_PROJECT };
