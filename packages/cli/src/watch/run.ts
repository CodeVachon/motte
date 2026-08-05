import { snapshotChanges, type Change, type Config, type Snapshot } from "@motte/core";
import { changeLine, frame } from "./render.js";

/**
 * The watch loop, with everything it touches passed in.
 *
 * Reading the backlog, watching the filesystem, the terminal and the clock are all dependencies rather than
 * imports, because every interesting behaviour here is otherwise untestable: what happens when a read
 * fails, what a resize redraws, what a non-terminal gets instead of a frame, and that stopping actually
 * stops. #0033 learned the same lesson about the HTTP server.
 */

export interface Screen {
    columns: number;
    rows: number;
    write: (text: string) => void;
    /** Returns an unsubscribe, and is absent where a resize cannot happen. */
    onResize?: (handler: () => void) => () => void;
}

export interface WatchDeps {
    /** Re-read everything. Throwing is expected — a write can be observed mid-rename. */
    read: () => Snapshot;
    /** Called with a callback to run whenever the backlog moves. Absent when polling instead. */
    watch?: (onChange: () => void) => () => void;
    /** Poll every this many milliseconds, for filesystems where watching does not work. */
    intervalMs?: number;
    screen: Screen;
    /** A terminal gets a redrawn frame; anything else gets plain lines it can pipe. */
    tty: boolean;
    /** How much history to keep. Bounded so a long session cannot grow without limit. */
    keep?: number;
}

const KEEP = 200;

/** Hide the cursor, take the alternate screen buffer, and put both back. */
const ENTER_FULLSCREEN = "\u001b[?1049h\u001b[?25l";
const LEAVE_FULLSCREEN = "\u001b[?25h\u001b[?1049l";
const CLEAR = "\u001b[H\u001b[2J";

export interface RunningWatch {
    stop: () => void;
}

export function startWatch(config: Config, deps: WatchDeps): RunningWatch {
    const keep = deps.keep ?? KEEP;
    const changes: Change[] = [];

    let previous: Snapshot | undefined;
    let problem: string | undefined;
    let live = true;
    let stopped = false;

    const draw = (): void => {
        if (stopped) return;

        if (!deps.tty) return;

        const lines = frame(
            config,
            { issues: previous?.issues ?? [], changes, live, problem },
            { columns: deps.screen.columns, rows: deps.screen.rows }
        );

        deps.screen.write(`${CLEAR}${lines.join("\n")}\n`);
    };

    /**
     * Re-read and report the difference.
     *
     * A failed read is shown rather than thrown: a file can be caught mid-write, and a dashboard that dies
     * the first time it observes a rename in progress is not a dashboard. The next successful read clears
     * the message.
     */
    const refresh = (): void => {
        if (stopped) return;

        let next: Snapshot;
        try {
            next = deps.read();
        } catch (thrown) {
            problem = `could not read the backlog: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
            draw();
            return;
        }

        problem = undefined;

        if (previous !== undefined) {
            const fresh = snapshotChanges(config, previous, next);

            for (const change of fresh) {
                changes.push(change);
                // In a pipe there is no frame to redraw, so each change is a line as it happens — which is
                // what makes `motte watch | tee` and `motte watch > log` useful.
                if (!deps.tty) deps.screen.write(`${changeLine(config, change)}\n`);
            }

            if (changes.length > keep) changes.splice(0, changes.length - keep);
        }

        previous = next;
        draw();
    };

    if (deps.tty) deps.screen.write(ENTER_FULLSCREEN);

    // The first read is the baseline: it reports nothing, because everything already on disk is not news.
    refresh();

    const unwatch = deps.watch?.(refresh);
    const timer = deps.intervalMs === undefined ? undefined : setInterval(refresh, deps.intervalMs);
    const unresize = deps.screen.onResize?.(draw);

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            live = false;

            unwatch?.();
            unresize?.();
            if (timer !== undefined) clearInterval(timer);

            // Restoring the terminal is the one thing that must happen however this ends: a shell left
            // without a cursor, in the alternate buffer, is worse than no dashboard at all.
            if (deps.tty) deps.screen.write(LEAVE_FULLSCREEN);
        }
    };
}
