import { useState } from "react";
import { IssueCard } from "../components/IssueCard.js";
import { api, type IssueResponse } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { byState, categoryColour, type Backlog } from "../lib/useBacklog.js";

/**
 * The board: a column per configured state, drag a card to move it.
 *
 * Columns come from the project's config rather than being hardcoded, so a project with a Blocked or Review
 * state gets a column for it without the UI knowing the name in advance.
 *
 * Native HTML5 drag and drop, no library. One drag interaction on a localhost tool did not justify the
 * dependency, and the whole of it is the three handlers below.
 */
export function Board({ backlog }: { backlog: Backlog }) {
    const [dragging, setDragging] = useState<number | undefined>(undefined);
    const [over, setOver] = useState<string | undefined>(undefined);

    if (backlog.config === undefined) return null;
    const columns = byState(backlog.config, backlog.issues);

    async function drop(state: string): Promise<void> {
        const id = dragging;
        setDragging(undefined);
        setOver(undefined);

        if (id === undefined) return;
        const issue = backlog.issues.find((candidate) => candidate.id === id);
        // Dropping a card back where it started is not a change, and writing anyway would bump `updated`
        // and add an event for nothing.
        if (issue === undefined || issue.state === state) return;

        await backlog.mutate(() => api.update(id, { state }));
    }

    return (
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="board">
            {columns.map((column) => (
                <section
                    key={column.state}
                    onDragOver={(event) => {
                        // Without preventDefault the browser refuses the drop entirely.
                        event.preventDefault();
                        setOver(column.state);
                    }}
                    onDragLeave={() =>
                        setOver((current) => (current === column.state ? undefined : current))
                    }
                    onDrop={(event) => {
                        event.preventDefault();
                        void drop(column.state);
                    }}
                    data-testid={`column-${column.state}`}
                    data-state={column.state}
                    className={cn(
                        "flex w-72 shrink-0 flex-col rounded-xl border border-border bg-background p-3",
                        over === column.state && "border-ring bg-muted/40"
                    )}
                >
                    <header className="mb-3 flex items-center gap-2">
                        <span
                            className={cn("size-2 rounded-full", categoryColour(column.category))}
                        />
                        <h2 className="flex-1 text-sm font-medium">{column.state}</h2>
                        <span className="text-xs tabular-nums text-muted-foreground">
                            {column.issues.length}
                        </span>
                    </header>

                    <div className="flex flex-col gap-2">
                        {column.issues.map((issue: IssueResponse) => (
                            <IssueCard
                                key={issue.id}
                                issue={issue}
                                dragging={dragging === issue.id}
                                onDragStart={setDragging}
                            />
                        ))}
                        {column.issues.length === 0 && (
                            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                                nothing here
                            </p>
                        )}
                    </div>
                </section>
            ))}
        </div>
    );
}
