import { cn } from "./lib/cn.js";
import { href, navigate, useRoute, type Route } from "./lib/router.js";
import { useBacklog, type Backlog } from "./lib/useBacklog.js";
import { Board } from "./views/Board.js";
import { Detail } from "./views/Detail.js";
import { Reports } from "./views/Reports.js";
import { Tree } from "./views/Tree.js";

/**
 * The shell: header, navigation, and whichever view the URL names.
 *
 * One `useBacklog` for the whole app rather than per-view fetching, so switching tabs is instant and every
 * view reads the same snapshot. A backlog is a few dozen files; holding all of it is cheaper than keeping
 * several partial copies in step.
 */

const TABS: { route: Route; label: string }[] = [
    { route: { name: "board" }, label: "Board" },
    { route: { name: "tree" }, label: "Tree" },
    { route: { name: "reports" }, label: "Reports" }
];

function Tab({ route, label, active }: { route: Route; label: string; active: boolean }) {
    const path = href(route);

    return (
        <a
            href={path}
            onClick={(event) => {
                // Left-click navigates in-app; a modified click keeps its normal browser meaning, so
                // open-in-new-tab still works.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate(path);
            }}
            data-testid={`tab-${label.toLowerCase()}`}
            className={cn(
                "rounded-lg px-3 py-1.5 text-sm",
                active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
            )}
        >
            {label}
        </a>
    );
}

function View({ route, backlog }: { route: Route; backlog: Backlog }) {
    switch (route.name) {
        case "board":
            return <Board backlog={backlog} />;
        case "tree":
            return <Tree backlog={backlog} />;
        case "reports":
            return <Reports backlog={backlog} />;
        case "issue":
            return <Detail backlog={backlog} id={route.id} />;
        case "unknown":
            return (
                <div data-testid="not-found">
                    <p className="mb-3 text-sm">
                        Nothing at <code className="font-mono">{route.path}</code>.
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate(href({ name: "board" }))}
                        className="text-sm text-muted-foreground hover:text-foreground"
                    >
                        Back to the board
                    </button>
                </div>
            );
    }
}

export function App() {
    const route = useRoute();
    const backlog = useBacklog();

    // An issue page is reached from the board, so the board stays the highlighted tab while on one.
    const active = route.name === "issue" || route.name === "unknown" ? "board" : route.name;

    return (
        <div className="min-h-full">
            <header className="border-b border-border">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
                    <div className="flex-1">
                        <a
                            href="/"
                            onClick={(event) => {
                                if (event.metaKey || event.ctrlKey || event.button !== 0) return;
                                event.preventDefault();
                                navigate("/");
                            }}
                            className="text-lg font-semibold"
                            data-testid="project-name"
                        >
                            {backlog.config?.name ?? "motte"}
                        </a>
                        {backlog.status !== undefined && (
                            <p className="text-xs text-muted-foreground" data-testid="summary">
                                {backlog.status.percentComplete}% · {backlog.status.completed} of{" "}
                                {backlog.status.counted} done · {backlog.status.ready.length} ready
                            </p>
                        )}
                    </div>
                    <nav className="flex items-center gap-1">
                        {TABS.map((tab) => (
                            <Tab
                                key={tab.label}
                                route={tab.route}
                                label={tab.label}
                                active={active === tab.route.name}
                            />
                        ))}
                    </nav>
                </div>
            </header>

            {/*
             * Above the error banner, and deliberately quieter: losing the stream does not mean anything
             * on screen is wrong, only that it has stopped being updated. Saying so is the whole point —
             * a stale board and a quiet one look identical, and the browser reconnects silently.
             */}
            {backlog.connection === "lost" && (
                <div
                    className="mx-auto mt-4 max-w-6xl px-6"
                    role="status"
                    data-testid="disconnected"
                >
                    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                        <span className="text-started">●</span>
                        <span className="flex-1">
                            Not connected to <code className="font-mono">motte serve</code>. This is
                            the last data it sent — reconnecting.
                        </span>
                    </div>
                </div>
            )}

            {backlog.error !== undefined && (
                <div className="mx-auto mt-4 max-w-6xl px-6" role="alert" data-testid="error">
                    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm">
                        <span className="text-started">!</span>
                        <span className="flex-1">{backlog.error}</span>
                        <button
                            type="button"
                            onClick={() => void backlog.reload()}
                            className="text-xs text-muted-foreground hover:text-foreground"
                        >
                            retry
                        </button>
                    </div>
                </div>
            )}

            <main className="mx-auto max-w-6xl px-6 py-6">
                {backlog.loading && backlog.config === undefined ? (
                    <p className="text-sm text-muted-foreground" data-testid="loading">
                        Loading…
                    </p>
                ) : (
                    <View route={route} backlog={backlog} />
                )}
            </main>
        </div>
    );
}
