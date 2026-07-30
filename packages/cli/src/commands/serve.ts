import type { CommandModule } from "yargs";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { context } from "../context.js";
import { startMotteServer } from "../serve/server.js";
import { directoryAssets, placeholderAssets, type AssetLookup } from "../serve/assets.js";
import { dim, heading, ok, warn } from "../ui/format.js";

interface ServeArgs {
    port?: number;
    open?: boolean;
    assets?: string;
}

/**
 * Open a URL in the default browser.
 *
 * Best effort and deliberately silent about its own failure: the URL has already been printed, so a
 * headless machine or an unusual desktop should not turn a working server into an error.
 */
function openInBrowser(url: string): void {
    const command =
        process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";

    try {
        const child = spawn(command, [url], {
            stdio: "ignore",
            detached: true,
            // `start` is a shell builtin on Windows rather than an executable.
            shell: process.platform === "win32"
        });
        child.on("error", () => {});
        child.unref();
    } catch {
        // Reported by the printed URL, which is the fallback either way.
    }
}

/**
 * Decide where the SPA comes from.
 *
 * Split out of the handler so it can be tested: the handler itself starts a listener and blocks until the
 * process is signalled, which makes it the one part of this command a test cannot drive.
 */
export function chooseAssets(dir: string | undefined): AssetLookup {
    if (dir === undefined) return placeholderAssets();

    if (!existsSync(dir)) {
        // Failing here beats starting a server that answers every page with a placeholder while the user
        // wonders why their build is not showing up.
        throw new Error(`no such assets directory: ${dir}`);
    }

    return directoryAssets(dir);
}

export const serveCommand: CommandModule<{}, ServeArgs> = {
    command: "serve",
    describe: "Run the local web interface",
    builder: (yargs) =>
        yargs
            .option("port", {
                type: "number",
                describe: "Port to listen on (0 picks a free one)",
                default: 4321
            })
            .option("open", { type: "boolean", describe: "Open the browser once listening" })
            .option("assets", {
                type: "string",
                describe: "Serve the SPA from this directory instead of the embedded build"
            }),
    handler: async (args) => {
        const { config } = context();

        const running = await startMotteServer(config, {
            ...(args.port === undefined ? {} : { port: args.port }),
            assets: chooseAssets(args.assets)
        });

        process.stdout.write(
            `\n${ok(`motte is serving ${config.name}`)}\n` +
                `${heading(running.url)}\n\n` +
                `${dim(`  ${config.root}`)}\n`
        );

        if (args.assets === undefined) {
            process.stdout.write(
                `\n${warn("the web interface is not built yet — the API is live, the pages are a placeholder")}\n` +
                    `${dim("  pass --assets <dir> to serve a local build")}\n`
            );
        }

        process.stdout.write(`\n${dim("Ctrl-C to stop.")}\n`);

        if (args.open === true) openInBrowser(running.url);

        // Stop cleanly on a signal, so the SSE streams are ended and the port is released rather than
        // being left in TIME_WAIT by an abrupt exit.
        const shutdown = (): void => {
            void running.close().then(() => process.exit(0));
        };

        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);

        // Resolve only when the server closes, so yargs does not think the command finished while it is
        // still listening.
        await new Promise<void>((resolve) => running.server.once("close", resolve));
    }
};
