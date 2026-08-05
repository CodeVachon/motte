import type { CommandModule } from "yargs";
import { context } from "../context.js";
import { dim, warn } from "../ui/format.js";
import { startWatch, type Screen, type WatchSource } from "../watch/run.js";
import { DEFAULT_LIMIT, collectAll, sourceFrom } from "../watch/sources.js";

/**
 * `motte watch` — the backlog, live.
 *
 * The motivating case is several agents working at once: seeing that one has started an issue and another
 * has finished one, as it happens. A static `motte status` stops being enough at that point.
 *
 * `--all` follows from the same motivation. Agents working in parallel are rarely all in one repository, and
 * the registry already knows which projects this machine has.
 *
 * Terminal-native rather than a browser tab on purpose. `motte serve` covers the browser; this is for the
 * window already open beside the editor.
 */

interface WatchArgs {
    all?: boolean;
    limit?: number;
    interval?: number;
}

/** Everything the loop needs from the process, in one place so the loop itself takes no globals. */
function terminal(): Screen {
    return {
        // `||` rather than `??`, deliberately: a terminal that reports zero rows or columns has told us
        // nothing useful, and the frame now trims itself to fit — so a zero taken at face value would
        // render a single line instead of a dashboard.
        get columns() {
            return process.stdout.columns || 80;
        },
        get rows() {
            return process.stdout.rows || 24;
        },
        write: (text) => {
            process.stdout.write(text);
        },
        onResize: (handler) => {
            process.stdout.on("resize", handler);
            return () => process.stdout.off("resize", handler);
        }
    };
}

/** The project in the working directory, as a single source. */
function here(watching: boolean): WatchSource {
    return sourceFrom(context().config, watching);
}

export const watchCommand: CommandModule<{}, WatchArgs> = {
    command: "watch",
    describe: "Watch the backlog change as it happens",
    builder: (yargs) =>
        yargs
            .option("all", {
                type: "boolean",
                describe: "Watch every registered project, not just this one"
            })
            .option("limit", {
                type: "number",
                default: DEFAULT_LIMIT,
                describe: "With --all, how many projects to watch at once"
            })
            .option("interval", {
                type: "number",
                describe: "Poll every N seconds instead of watching the filesystem"
            }),
    handler: (args) => {
        const polling = args.interval !== undefined && args.interval > 0;
        const tty = process.stdout.isTTY === true;
        const out = process.stdout;

        // Watching and polling are alternatives, not both: on a filesystem where watching is unreliable,
        // the point of --interval is to stop depending on it.
        const watching = !polling;

        const collected =
            args.all === true
                ? collectAll({ watching, limit: Math.max(1, args.limit ?? DEFAULT_LIMIT) })
                : { sources: [here(watching)], omitted: 0, unreadable: [] };

        if (collected.sources.length === 0) {
            out.write(
                `${warn("no projects to watch")}\n` +
                    `${dim("  `motte projects` lists what this machine knows about, and `motte projects --prune` clears the stale ones.")}\n`
            );
            process.exitCode = 1;
            return;
        }

        /**
         * A stale registry entry is worth saying out loud once, then ignoring.
         *
         * Reported before the frame takes over the screen — inside the alternate buffer it would be wiped
         * by the first redraw, and after it by the restore.
         */
        for (const skipped of collected.unreadable) {
            out.write(
                `${warn(`skipping ${skipped.name}`)} ${dim(`${skipped.root} — ${skipped.reason}`)}\n`
            );
        }

        const running = startWatch(collected.sources, {
            ...(polling ? { intervalMs: Math.max(1, args.interval!) * 1000 } : {}),
            screen: terminal(),
            tty,
            ...(collected.omitted === 0 ? {} : { omitted: collected.omitted })
        });

        if (!tty) {
            const what =
                collected.sources.length === 1
                    ? collected.sources[0]!.name
                    : `${collected.sources.length} projects`;

            out.write(
                `${dim(`watching ${what}${polling ? ` every ${args.interval}s` : ""} — one line per change`)}\n`
            );
        }

        /**
         * Every way this can end, restoring the terminal on each.
         *
         * A shell left in the alternate buffer with no cursor is worse than no dashboard, and it is the
         * kind of damage that outlives the process — so the handlers cover the signals, a closed pipe, and
         * an exception nobody expected.
         */
        let ending = false;
        const finish = (code?: number): void => {
            if (ending) return;
            ending = true;

            running.stop();
            if (code !== undefined) process.exit(code);
        };

        process.on("SIGINT", () => finish(0));
        process.on("SIGTERM", () => finish(0));
        process.on("uncaughtException", (thrown) => {
            running.stop();
            throw thrown;
        });
        // `motte watch | head` closes the pipe; ending quietly is the right answer, as it is for `status`.
        process.stdout.on("error", () => finish(0));
        process.on("exit", () => {
            running.stop();
        });
    }
};
