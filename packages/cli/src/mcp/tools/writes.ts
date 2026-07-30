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
}
