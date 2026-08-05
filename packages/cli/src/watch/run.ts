import { snapshotChanges, type Config, type Snapshot } from "@motte/core";
import { changeLine, frame, type ProjectView, type TaggedChange } from "./render.js";

/**
 * The watch loop, with everything it touches passed in.
 *
 * Reading the backlog, watching the filesystem, the terminal and the clock are all dependencies rather than
 * imports, because every interesting behaviour here is otherwise untestable: what happens when a read
 * fails, what a resize redraws, what a non-terminal gets instead of a frame, and that stopping actually
 * stops. #0033 learned the same lesson about the HTTP server.
 *
 * Takes a list of sources rather than one, because `--all` watches every registered project. One source is
 * the ordinary case and goes down the same path — two renderers that had to agree would drift, and a change
 * from one project rendered against another's states would be quietly wrong.
 */

export interface Screen {
    columns: number;
    rows: number;
    write: (text: string) => void;
    /** Returns an unsubscribe, and is absent where a resize cannot happen. */
    onResize?: (handler: () => void) => () => void;
}

/** One project to watch: what to call it, how to read it, and how to know it moved. */
export interface WatchSource {
    name: string;
    config: Config;
    /** Re-read everything. Throwing is expected — a write can be observed mid-rename. */
    read: () => Snapshot;
    /** Called with a callback to run whenever this backlog moves. Absent when polling instead. */
    watch?: (onChange: () => void) => () => void;
}

export interface WatchDeps {
    /** Poll every this many milliseconds, for filesystems where watching does not work. */
    intervalMs?: number;
    screen: Screen;
    /** A terminal gets a redrawn frame; anything else gets plain lines it can pipe. */
    tty: boolean;
    /** How much history to keep. Bounded so a long session cannot grow without limit. */
    keep?: number;
    /** Registered projects deliberately left unwatched, so the frame can say so. */
    omitted?: number;
}

const KEEP = 200;

/** Hide the cursor, take the alternate screen buffer, and put both back. */
const ENTER_FULLSCREEN = "\u001b[?1049h\u001b[?25l";
const LEAVE_FULLSCREEN = "\u001b[?25h\u001b[?1049l";
const CLEAR = "\u001b[H\u001b[2J";

export interface RunningWatch {
    stop: () => void;
}

interface Tracked {
    source: WatchSource;
    view: ProjectView;
    previous?: Snapshot;
}

export function startWatch(sources: readonly WatchSource[], deps: WatchDeps): RunningWatch {
    const keep = deps.keep ?? KEEP;
    const changes: TaggedChange[] = [];

    const tracked: Tracked[] = sources.map((source) => ({
        source,
        view: { name: source.name, config: source.config, issues: [] }
    }));

    let live = true;
    let stopped = false;

    const draw = (): void => {
        if (stopped || !deps.tty) return;

        const lines = frame(
            {
                projects: tracked.map((entry) => entry.view),
                changes,
                live,
                ...(deps.omitted === undefined ? {} : { omitted: deps.omitted })
            },
            { columns: deps.screen.columns, rows: deps.screen.rows }
        );

        deps.screen.write(`${CLEAR}${lines.join("\n")}\n`);
    };

    /**
     * Re-read one project and report the difference.
     *
     * A failed read is shown rather than thrown: a file can be caught mid-write, and a dashboard that dies
     * the first time it observes a rename in progress is not a dashboard. The next successful read clears
     * the message. With several projects it also has to be per-project — one unreadable backlog must not
     * blank out the others.
     */
    const refresh = (entry: Tracked): void => {
        if (stopped) return;

        let next: Snapshot;
        try {
            next = entry.source.read();
        } catch (thrown) {
            entry.view = {
                ...entry.view,
                problem: `could not read the backlog: ${thrown instanceof Error ? thrown.message : String(thrown)}`
            };
            draw();
            return;
        }

        const view: ProjectView = {
            name: entry.source.name,
            config: entry.source.config,
            issues: next.issues
        };
        entry.view = view;

        if (entry.previous !== undefined) {
            const fresh = snapshotChanges(entry.source.config, entry.previous, next);

            for (const change of fresh) {
                changes.push({ project: view, change });
                // In a pipe there is no frame to redraw, so each change is a line as it happens — which is
                // what makes `motte watch | tee` and `motte watch > log` useful.
                if (!deps.tty) {
                    deps.screen.write(`${changeLine(view, change, labelWidth())}\n`);
                }
            }

            if (changes.length > keep) changes.splice(0, changes.length - keep);
        }

        entry.previous = next;
        draw();
    };

    /** Zero for a single project, so its lines carry no redundant column. */
    const labelWidth = (): number =>
        sources.length > 1 ? Math.max(...sources.map((source) => source.name.length), 1) : 0;

    if (deps.tty) deps.screen.write(ENTER_FULLSCREEN);

    // The first read is the baseline: it reports nothing, because everything already on disk is not news.
    for (const entry of tracked) refresh(entry);

    const refreshAll = (): void => {
        for (const entry of tracked) refresh(entry);
    };

    const unwatchers = tracked.map((entry) => entry.source.watch?.(() => refresh(entry)));
    const timer =
        deps.intervalMs === undefined ? undefined : setInterval(refreshAll, deps.intervalMs);
    const unresize = deps.screen.onResize?.(draw);

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            live = false;

            for (const unwatch of unwatchers) unwatch?.();
            unresize?.();
            if (timer !== undefined) clearInterval(timer);

            // Restoring the terminal is the one thing that must happen however this ends: a shell left
            // without a cursor, in the alternate buffer, is worse than no dashboard at all.
            if (deps.tty) deps.screen.write(LEAVE_FULLSCREEN);
        }
    };
}
