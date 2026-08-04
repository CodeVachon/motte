import type { IssueResponse } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { href, navigate } from "../lib/router.js";

/**
 * One issue, as it appears on the board.
 *
 * A button rather than an anchor wrapping a draggable div: a nested interactive element inside a draggable
 * one makes the drag start unreliable, and the click handler navigates through the same `navigate` the links
 * use. Middle-click and open-in-new-tab are lost, which for a localhost single-user tool is a fair trade for
 * a drag that works.
 */
export function IssueCard({
    issue,
    onDragStart,
    dragging
}: {
    issue: IssueResponse;
    onDragStart: (id: number) => void;
    dragging: boolean;
}) {
    const blocked = issue.openBlockers.length > 0;

    return (
        <div
            draggable
            onDragStart={(event) => {
                // Both: `setData` is what makes the drop target accept it in Firefox, and the id in state is
                // what the drop handler actually reads.
                event.dataTransfer.setData("text/plain", String(issue.id));
                event.dataTransfer.effectAllowed = "move";
                onDragStart(issue.id);
            }}
            data-testid={`card-${issue.id}`}
            data-issue-id={issue.id}
            className={cn(
                "group cursor-grab rounded-lg border border-border bg-card p-3 text-left",
                "hover:border-ring focus-within:border-ring active:cursor-grabbing",
                dragging && "opacity-40"
            )}
        >
            <button
                type="button"
                onClick={() => navigate(href({ name: "issue", id: issue.id }))}
                className="w-full text-left focus:outline-none"
            >
                <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                        #{String(issue.id).padStart(4, "0")}
                    </span>
                    {blocked && (
                        <span
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                            title={`Waiting on ${issue.openBlockers.map((id) => `#${id}`).join(", ")}`}
                            data-testid={`blocked-${issue.id}`}
                        >
                            blocked
                        </span>
                    )}
                </div>
                <div className="mt-1 text-sm leading-snug">{issue.title}</div>
            </button>

            {(issue.labels.length > 0 || issue.assignee !== null) && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                    {issue.assignee !== null && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {issue.assignee}
                        </span>
                    )}
                    {issue.labels.map((label) => (
                        <span
                            key={label}
                            className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                            {label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
