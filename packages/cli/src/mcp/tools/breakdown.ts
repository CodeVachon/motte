import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ready, subtreeReport, type Issue } from "@motte/core";
import type { ToolContext } from "../toolContext.js";
import { issueJson, text } from "../shape.js";

/**
 * `breakdown`: create many children under one parent in a single call.
 *
 * Its own module because it is the largest tool by a wide margin — it validates the whole batch, resolves
 * `blockedByIndex` references between siblings, and must leave nothing behind if any child is rejected.
 */
export function registerBreakdownTool(server: McpServer, tools: ToolContext): void {
    const { open, guard, author } = tools;

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
}
