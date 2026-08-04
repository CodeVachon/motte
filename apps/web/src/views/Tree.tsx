import { useState } from "react";
import { api, type IssueResponse } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { categoryColour, type Backlog } from "../lib/useBacklog.js";
import { href, navigate } from "../lib/router.js";
import type { ConfigResponse } from "../lib/api.js";

/**
 * The hierarchy, with drag to re-parent.
 *
 * Built from the issues already in hand rather than `GET /api/tree`: the board and this view then render the
 * same snapshot, and a re-parent shows up here without waiting for a second request. The tree endpoint stays
 * for other consumers.
 *
 * A cycle is refused by the server — `store.update` throws `CycleError`, which the API answers 409 — so this
 * view does not duplicate that rule. It only avoids the one case it can see for certain: dropping something
 * onto itself.
 */

interface Node {
    issue: IssueResponse;
    children: Node[];
}

function build(issues: IssueResponse[]): { roots: Node[]; orphans: IssueResponse[] } {
    const nodes = new Map<number, Node>(issues.map((issue) => [issue.id, { issue, children: [] }]));
    const roots: Node[] = [];
    const orphans: IssueResponse[] = [];

    for (const node of nodes.values()) {
        const parent = node.issue.parent;

        if (parent === null) {
            roots.push(node);
            continue;
        }

        const above = nodes.get(parent);
        if (above === undefined) {
            // The parent is not in the list — pruned, or the file is missing. `motte doctor` reports it;
            // showing the issue at the top beats hiding it.
            orphans.push(node.issue);
            roots.push(node);
            continue;
        }

        above.children.push(node);
    }

    return { roots, orphans };
}

function Row({
    node,
    depth,
    config,
    dragging,
    setDragging,
    onDrop
}: {
    node: Node;
    depth: number;
    config: ConfigResponse;
    dragging: number | undefined;
    setDragging: (id: number | undefined) => void;
    onDrop: (child: number, parent: number | null) => void;
}) {
    const [over, setOver] = useState(false);
    const category = config.states.find((state) => state.name === node.issue.state)?.category ?? "";
    const isDragging = dragging === node.issue.id;

    return (
        <>
            <li
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(node.issue.id));
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(node.issue.id);
                }}
                onDragEnd={() => setDragging(undefined)}
                onDragOver={(event) => {
                    // Dropping onto itself is the one invalid move visible from here; every other rule is
                    // the server's to enforce.
                    if (dragging === node.issue.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOver(false);
                    if (dragging !== undefined && dragging !== node.issue.id) {
                        onDrop(dragging, node.issue.id);
                    }
                }}
                data-testid={`tree-row-${node.issue.id}`}
                className={cn(
                    "flex cursor-grab items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/60",
                    over && "ring-1 ring-ring",
                    isDragging && "opacity-40"
                )}
                style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
            >
                <span className={cn("size-1.5 shrink-0 rounded-full", categoryColour(category))} />
                <button
                    type="button"
                    onClick={() => navigate(href({ name: "issue", id: node.issue.id }))}
                    className="flex flex-1 items-baseline gap-2 text-left"
                >
                    <span className="font-mono text-xs text-muted-foreground">
                        #{String(node.issue.id).padStart(4, "0")}
                    </span>
                    <span className="text-sm">{node.issue.title}</span>
                </button>
                <span className="text-xs text-muted-foreground">{node.issue.state}</span>
            </li>

            {node.children.map((child) => (
                <Row
                    key={child.issue.id}
                    node={child}
                    depth={depth + 1}
                    config={config}
                    dragging={dragging}
                    setDragging={setDragging}
                    onDrop={onDrop}
                />
            ))}
        </>
    );
}

export function Tree({ backlog }: { backlog: Backlog }) {
    const [dragging, setDragging] = useState<number | undefined>(undefined);
    const [overRoot, setOverRoot] = useState(false);

    if (backlog.config === undefined) return null;
    const { roots, orphans } = build(backlog.issues);
    const config = backlog.config;

    async function reparent(child: number, parent: number | null): Promise<void> {
        setDragging(undefined);
        const issue = backlog.issues.find((candidate) => candidate.id === child);
        if (issue === undefined || issue.parent === parent) return;

        await backlog.mutate(() => api.update(child, { parent }));
    }

    return (
        <div data-testid="tree">
            {orphans.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                    {orphans.map((issue) => `#${issue.id}`).join(", ")} name a parent that is not
                    here — run <code className="font-mono">motte doctor</code>.
                </p>
            )}

            <ul className="rounded-lg border border-border p-1">
                {roots.map((root) => (
                    <Row
                        key={root.issue.id}
                        node={root}
                        depth={0}
                        config={config}
                        dragging={dragging}
                        setDragging={setDragging}
                        onDrop={(child, parent) => void reparent(child, parent)}
                    />
                ))}
            </ul>

            {/* Somewhere to drop something to make it a root, since there is no row representing "no parent". */}
            <div
                onDragOver={(event) => {
                    event.preventDefault();
                    setOverRoot(true);
                }}
                onDragLeave={() => setOverRoot(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setOverRoot(false);
                    if (dragging !== undefined) void reparent(dragging, null);
                }}
                data-testid="tree-root-target"
                className={cn(
                    "mt-3 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground",
                    overRoot && "border-ring text-foreground"
                )}
            >
                drop here to make it a top-level issue
            </div>
        </div>
    );
}
