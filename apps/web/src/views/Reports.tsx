import { cn } from "../lib/cn.js";
import { categoryColour, type Backlog } from "../lib/useBacklog.js";
import { href, navigate } from "../lib/router.js";

/**
 * Progress, and the same per-epic rollups `motte status --epics` prints.
 *
 * Every number here comes from the server. Recomputing them from the issue list the client already holds is
 * tempting and was tried; it produced a second definition of "how complete is this epic" that disagreed with
 * core's within minutes.
 */
function Bar({ percent, className }: { percent: number; className?: string }) {
    return (
        <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
            <div className="h-full bg-completed" style={{ width: `${percent}%` }} />
        </div>
    );
}

export function Reports({ backlog }: { backlog: Backlog }) {
    const { config, status } = backlog;
    if (config === undefined || status === undefined) return null;

    // Straight from the server, which computes them with core's `epicReports`. An earlier version worked
    // them out here from the issue list and got a different answer — core scopes a rollup to the epic and
    // every descendant, while this counted direct children and left the epic out, so the page said 25%
    // where `motte status --epics` said 20%.
    const epics = status.epics;

    return (
        <div className="flex flex-col gap-8" data-testid="reports">
            <section>
                <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Overall</h2>
                    <span className="text-sm tabular-nums" data-testid="overall-percent">
                        {status.percentComplete}%
                    </span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    {status.byState
                        .filter((bucket) => bucket.count > 0)
                        .map((bucket) => (
                            <div
                                key={bucket.state}
                                className={cn("h-full", categoryColour(bucket.category))}
                                style={{
                                    width: `${(bucket.count / Math.max(1, status.total)) * 100}%`
                                }}
                                title={`${bucket.state}: ${bucket.count}`}
                            />
                        ))}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                        ["Total", status.total],
                        ["Done", status.completed],
                        ["Ready", status.ready.length],
                        ["Blocked", status.blocked.length]
                    ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg border border-border p-4">
                            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
                            <dt className="text-sm text-muted-foreground">{label}</dt>
                        </div>
                    ))}
                </dl>
            </section>

            <section>
                <h2 className="mb-3 text-sm font-medium">
                    Epics <span className="text-muted-foreground">({epics.length})</span>
                </h2>
                {epics.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No issue has children yet. Give one a child and it becomes an epic.
                    </p>
                ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {epics.map((epic) => (
                            <li key={epic.id} className="p-3" data-testid={`epic-${epic.id}`}>
                                <button
                                    type="button"
                                    onClick={() => navigate(href({ name: "issue", id: epic.id }))}
                                    className="mb-2 flex w-full items-baseline gap-2 text-left"
                                >
                                    <span className="font-mono text-xs text-muted-foreground">
                                        #{String(epic.id).padStart(4, "0")}
                                    </span>
                                    <span className="flex-1 text-sm">{epic.title}</span>
                                    <span className="text-xs tabular-nums text-muted-foreground">
                                        {epic.completed}/{epic.counted}
                                    </span>
                                    <span className="w-10 text-right text-xs tabular-nums">
                                        {epic.percentComplete}%
                                    </span>
                                </button>
                                <Bar percent={epic.percentComplete} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
