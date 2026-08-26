import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../toolContext.js";
import { issueJson, text } from "../shape.js";

/** The mutating tools, apart from `breakdown`. */
export function registerWriteTools(server: McpServer, tools: ToolContext): void {
    const { open, guard, author } = tools;

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
                blockedBy: z.array(z.number().int()).optional(),
                fields: z
                    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
                    .optional()
                    .describe(
                        "Configured custom frontmatter fields; use status_report to discover definitions"
                    )
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
                fields?: Record<string, string | number | boolean>;
            }) => {
                const { config, store } = open();
                const issue = store.create(args);
                return text({ created: issueJson(config, store.all(), issue) });
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
                labels: z.array(z.string()).optional(),
                fields: z
                    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
                    .optional()
                    .describe("Configured custom frontmatter fields; null clears an optional field")
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

    /**
     * Claiming, which is the step that makes several agents on one backlog workable.
     *
     * Placed before `set_state` deliberately: an agent that moves an issue to In Progress by hand has
     * announced nothing and can still collide with another agent doing the same. Claiming refuses, and a
     * refusal is information — ask `next_issue` again and take something else.
     */
    server.registerTool(
        "claim_issue",
        {
            title: "Claim an issue",
            description:
                "Take an issue: assign it to this agent and start it, in one step. Fails if somebody " +
                "else already holds it, which means another agent is on it — ask next_issue for another. " +
                "Call this before doing any work on an issue.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                force: z
                    .boolean()
                    .optional()
                    .describe("Take it even if somebody else holds it. Rarely right for an agent.")
            }
        },
        guard((args: { ref: number | string; force?: boolean }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.claim(target.id, tools.author(), { force: args.force === true });

            return text({ claimed: issueJson(config, store.all(), issue) });
        })
    );

    server.registerTool(
        "release_issue",
        {
            title: "Release an issue",
            description:
                "Put an issue back: clear the assignee and return it to the default state. Call this if " +
                "you abandon work you claimed, so the next agent can pick it up.",
            inputSchema: {
                ref: z.union([z.number().int(), z.string()]),
                force: z.boolean().optional().describe("Release it even if somebody else holds it")
            }
        },
        guard((args: { ref: number | string; force?: boolean }) => {
            const { config, store } = open();
            const target = store.resolve(args.ref);
            const issue = store.release(target.id, tools.author(), { force: args.force === true });

            return text({ released: issueJson(config, store.all(), issue) });
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

    /**
     * Exposed to agents because agents are how duplicates get filed: two of them read the same backlog,
     * neither sees the other's create, and the same work exists twice under two numbers.
     *
     * Unlike prune — which is deliberately CLI-only — this destroys nothing, so an agent reaching for it
     * cannot lose anybody's writing.
     */
    server.registerTool(
        "merge_issues",
        {
            title: "Merge a duplicate issue",
            description:
                "Fold a duplicate into the issue that keeps the work. Notes, children, blockers and " +
                "labels move across, and the duplicate's description and plan are kept as a note. " +
                "Use this rather than closing a duplicate as done — that would count it as finished work. " +
                "Refuses when the two are parent and child.",
            inputSchema: {
                from: z.union([z.number().int(), z.string()]).describe("The duplicate, which goes"),
                into: z
                    .union([z.number().int(), z.string()])
                    .describe("The issue that keeps the work")
            }
        },
        guard((args: { from: number | string; into: number | string }) => {
            const { config, store } = open();
            const from = store.resolve(args.from);
            const into = store.resolve(args.into);

            const plan = store.planMerge(from.id, into.id);
            const survivor = store.merge(from.id, into.id, author());

            return text({
                merged: { id: from.id, title: from.title },
                into: issueJson(config, store.all(), survivor),
                moved: {
                    notes: plan.notes,
                    children: plan.children.map((child) => child.id),
                    dependents: plan.dependents.map((issue) => issue.id),
                    labels: plan.labels
                }
            });
        })
    );
}
