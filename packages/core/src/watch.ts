import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename } from "node:path";
import { eventsDir } from "./events.js";
import type { Config } from "./schema/config.js";

/**
 * What changed. Deliberately coarse.
 *
 * The watcher reports that the backlog moved, not what moved in it. Working out the difference would mean
 * keeping a shadow copy of every issue and diffing on each event, and every consumer so far — the SSE
 * endpoint, and the `motte watch` dashboard in #0060 — re-reads through `IssueStore` anyway, which is
 * cached by mtime and so only re-parses what actually changed.
 */
export interface BacklogChange {
    /** Issue ids inferred from the filenames that changed, where a filename gave one up. */
    ids: number[];
    /** True when the event log changed rather than an issue file. */
    events: boolean;
}

/** A directory subscription. Matches the slice of `fs.FSWatcher` this module uses. */
export interface DirWatcher {
    close(): void;
}

/**
 * How to subscribe to a directory. Defaults to `fs.watch`.
 *
 * Injectable so the coalescing and attribution logic can be tested by delivering events directly.
 * Driving it through a real filesystem instead made the tests depend on how promptly macOS chooses to
 * report a write, which under a loaded machine is anywhere from immediate to not within five seconds —
 * so the same assertions passed alone and failed one full-suite run in three. Whether `fs.watch` fires
 * is Node's contract to keep, not this module's; what this module owes is the right change for a given
 * sequence of events.
 */
export type WatchFactory = (dir: string, onEvent: (filename: string | null) => void) => DirWatcher;

export interface WatchOptions {
    /**
     * How long to wait for the dust to settle, in milliseconds.
     *
     * A single logical write produces several filesystem events: `IssueStore` writes to a temp file and
     * renames it, editors often do the same, and a `breakdown` creating ten children is ten writes in a
     * row. Without a debounce a consumer would redraw or push SSE per event.
     */
    debounceMs?: number;
    signal?: AbortSignal;
    /** Overridden in tests. See `WatchFactory`. */
    watchDir?: WatchFactory;
}

const ID_FROM_NAME = /^(\d+)-/;

/**
 * Watch a project's issues and event log, calling `onChange` once per settled burst.
 *
 * Returns a stop function. Safe to call when the directories do not exist yet — nothing is watched and
 * nothing throws, which matters because `motte serve` may start before the first `motte init`.
 *
 * One property worth knowing: a change made just before watching started can still be delivered just
 * after. macOS reports directory events with a latency, and the event carries the watched directory's own
 * name rather than a file, so creating `.motte/events` and then immediately watching yields one change
 * that nothing in the current session caused. It cannot be filtered — the event is indistinguishable from
 * a real one — and it is harmless, because every consumer's response to a change is to re-read. Callers
 * that assert on exact change sequences need to let the filesystem settle first.
 */
export function watchBacklog(
    config: Config,
    onChange: (change: BacklogChange) => void,
    options: WatchOptions = {}
): () => void {
    const debounceMs = options.debounceMs ?? 50;
    const watchDir = options.watchDir ?? defaultWatchFactory;

    const watchers: DirWatcher[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingIds = new Set<number>();
    let pendingEvents = false;
    let stopped = false;

    const flush = (): void => {
        timer = undefined;
        if (stopped) return;

        const change: BacklogChange = {
            ids: [...pendingIds].sort((a, b) => a - b),
            events: pendingEvents
        };

        pendingIds = new Set();
        pendingEvents = false;

        // Nothing recognisable changed — a stray file in the directory, say. Still worth reporting, since
        // a consumer's job is to re-read, and an empty `ids` with `events: false` says "something moved".
        onChange(change);
    };

    const schedule = (): void => {
        if (stopped) return;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
        // Do not hold the process open on account of a pending redraw.
        timer.unref?.();
    };

    const record = (filename: string | null, isEvents: boolean): void => {
        if (isEvents) {
            pendingEvents = true;
        } else if (filename !== null) {
            const match = ID_FROM_NAME.exec(basename(filename));
            // Temp files from the atomic write land here too; they have no id prefix, so they are simply
            // not attributed to an issue rather than being filtered by name.
            if (match) pendingIds.add(Number(match[1]));
        }

        schedule();
    };

    const add = (dir: string, isEvents: boolean): void => {
        if (!existsSync(dir)) return;

        try {
            watchers.push(watchDir(dir, (filename) => record(filename, isEvents)));
        } catch {
            // Watching is best-effort. `motte serve` still works without live updates.
        }
    };

    add(config.issuesPath, false);
    if (config.events.enabled) add(eventsDir(config.root), true);

    const stop = (): void => {
        if (stopped) return;
        stopped = true;

        if (timer !== undefined) clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
        watchers.length = 0;
    };

    options.signal?.addEventListener("abort", stop, { once: true });

    return stop;
}

/**
 * The real thing: one `fs.watch` per directory.
 *
 * A watcher error — the directory being deleted from under us, say — must not crash the host. Consumers
 * re-read on the next change, so there is nothing useful to do with it here.
 */
const defaultWatchFactory: WatchFactory = (dir, onEvent) => {
    const watcher: FSWatcher = watch(dir, (_event, filename) => {
        onEvent(filename === null ? null : String(filename));
    });

    watcher.on("error", () => {});
    return watcher;
};
