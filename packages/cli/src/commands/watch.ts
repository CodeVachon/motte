import type { CommandModule } from "yargs";
import { watchBacklog, type Snapshot } from "@motte/core";
import { context } from "../context.js";
import { dim } from "../ui/format.js";
import { startWatch, type Screen } from "../watch/run.js";

/**
 * `motte watch` — the backlog, live.
 *
 * The motivating case is several agents working at once: seeing that one has started an issue and another
 * has finished one, as it happens. A static `motte status` stops being enough at that point.
 *
 * Terminal-native rather than a browser tab on purpose. `motte serve` covers the browser; this is for the
 * window already open beside the editor.
 */

interface WatchArgs {
    interval?: number;
}

/** Everything the loop needs from the process, in one place so the loop itself takes no globals. */
function terminal(): Screen {
    return {
        get columns() {
            return process.stdout.columns ?? 80;
        },
        get rows() {
            return process.stdout.rows ?? 24;
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

export const watchCommand: CommandModule<{}, WatchArgs> = {
    command: "watch",
    describe: "Watch the backlog change as it happens",
    builder: (yargs) =>
        yargs.option("interval", {
            type: "number",
            describe: "Poll every N seconds instead of watching the filesystem"
        }),
    handler: (args) => {
        const { config, store } = context();

        // A fresh store per read, because the caching one keys parses by mtime and the whole job here is
        // to notice writes as they land.
        const read = (): Snapshot => {
            const fresh = context().store;
            return { issues: fresh.all(), events: fresh.events().events };
        };

        const polling = args.interval !== undefined && args.interval > 0;
        const tty = process.stdout.isTTY === true;

        const running = startWatch(config, {
            read,
            // Watching and polling are alternatives, not both: on a filesystem where watching is
            // unreliable, the point of --interval is to stop depending on it.
            ...(polling
                ? { intervalMs: Math.max(1, args.interval!) * 1000 }
                : { watch: (onChange: () => void) => watchBacklog(config, () => onChange()) }),
            screen: terminal(),
            tty
        });

        if (!tty) {
            process.stdout.write(
                `${dim(`watching ${config.name}${polling ? ` every ${args.interval}s` : ""} — one line per change`)}\n`
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

        // Nothing else to do: the process stays alive because the watcher (or the interval) holds it open.
        store.all();
    }
};
