import { useCallback, useEffect, useState } from "react";
import { api, subscribe, ApiError, type ConfigResponse, type StatusResponse } from "./lib/api.js";
import { cn } from "./lib/cn.js";

/**
 * The shell: enough to prove the whole path works end to end — served assets, the JSON API, and a live
 * update when the backlog changes underneath.
 *
 * The board, tree, issue detail and reports are #0034. What is here deliberately is the plumbing every one
 * of those views will need: loading, the error state for a server that has stopped, and the SSE
 * subscription that makes a tab notice an agent's write.
 */

const CATEGORY_COLOUR: Record<string, string> = {
    unstarted: "bg-unstarted",
    started: "bg-started",
    completed: "bg-completed",
    cancelled: "bg-cancelled"
};

function ProgressBar({ status }: { status: StatusResponse }) {
    return (
        <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={status.percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Project completion"
        >
            {status.byState
                .filter((bucket) => bucket.count > 0)
                .map((bucket) => (
                    <div
                        key={bucket.state}
                        className={cn("h-full", CATEGORY_COLOUR[bucket.category] ?? "bg-muted")}
                        style={{ width: `${(bucket.count / Math.max(1, status.total)) * 100}%` }}
                        title={`${bucket.state}: ${bucket.count}`}
                    />
                ))}
        </div>
    );
}

function Stat({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
        </div>
    );
}

export function App() {
    const [config, setConfig] = useState<ConfigResponse | undefined>(undefined);
    const [status, setStatus] = useState<StatusResponse | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);

    const load = useCallback(async () => {
        try {
            const [nextConfig, nextStatus] = await Promise.all([api.config(), api.status()]);
            setConfig(nextConfig);
            setStatus(nextStatus);
            setError(undefined);
        } catch (thrown) {
            setError(thrown instanceof ApiError ? thrown.message : String(thrown));
        }
    }, []);

    useEffect(() => {
        void load();
        // Re-fetch rather than patching from the event: the server reports that something changed, not what.
        return subscribe(() => void load());
    }, [load]);

    if (error !== undefined) {
        return (
            <main className="mx-auto max-w-2xl p-8" data-testid="error">
                <h1 className="mb-2 text-xl font-semibold">motte is not reachable</h1>
                <p className="text-muted-foreground">{error}</p>
            </main>
        );
    }

    if (config === undefined || status === undefined) {
        return (
            <main className="mx-auto max-w-2xl p-8 text-muted-foreground" data-testid="loading">
                Loading…
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-4xl p-8" data-testid="dashboard">
            <header className="mb-8">
                <h1 className="text-2xl font-semibold" data-testid="project-name">
                    {config.name}
                </h1>
                <p className="font-mono text-sm text-muted-foreground">{config.root}</p>
            </header>

            <section className="mb-8">
                <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Progress</span>
                    <span className="text-sm tabular-nums" data-testid="percent">
                        {status.percentComplete}%
                    </span>
                </div>
                <ProgressBar status={status} />
            </section>

            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total" value={status.total} />
                <Stat label="Done" value={status.completed} />
                <Stat label="Ready" value={status.ready.length} />
                <Stat label="Blocked" value={status.blocked.length} />
            </section>

            <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">By state</h2>
                <ul
                    className="divide-y divide-border rounded-lg border border-border"
                    data-testid="by-state"
                >
                    {status.byState.map((bucket) => (
                        <li key={bucket.state} className="flex items-center gap-3 p-3">
                            <span
                                className={cn(
                                    "size-2 rounded-full",
                                    CATEGORY_COLOUR[bucket.category] ?? "bg-muted"
                                )}
                            />
                            <span className="flex-1">{bucket.state}</span>
                            <span className="tabular-nums text-muted-foreground">
                                {bucket.count}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            <p className="mt-8 text-sm text-muted-foreground">
                The board, tree and issue views are next — see #0034. This page updates on its own
                when the backlog changes on disk.
            </p>
        </main>
    );
}
