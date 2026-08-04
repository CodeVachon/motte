import type { CommandModule } from "yargs";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { context } from "../context.js";
import { startMotteServer } from "../serve/server.js";
import {
    directoryAssets,
    embeddedAssets,
    placeholderAssets,
    type AssetLookup
} from "../serve/assets.js";
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
 * The SPA compiled into this binary, if there is one.
 *
 * A dynamic import in a try/catch, because `generated/webAssets.ts` is written by the build and gitignored:
 * a clone that has never run `bun run build:web` does not have it. `bun build --compile` resolves the
 * specifier statically and bundles the module, so a released binary always finds it.
 */
async function embedded(): Promise<AssetLookup | undefined> {
    try {
        const { ASSETS } = await import("../generated/webAssets.js");
        // An empty map is the same as no build: fall through to the placeholder rather than 404 every page.
        return Object.keys(ASSETS).length === 0 ? undefined : embeddedAssets(ASSETS);
    } catch {
        return undefined;
    }
}

/**
 * Decide where the SPA comes from: an explicit directory, the embedded build, or the placeholder.
 *
 * Split out of the handler so it can be tested — the handler starts a listener and blocks until the process
 * is signalled, which makes it the one part of this command a test cannot drive.
 */
export async function chooseAssets(
    dir: string | undefined
): Promise<{ assets: AssetLookup; source: "directory" | "embedded" | "placeholder" }> {
    if (dir !== undefined) {
        if (!existsSync(dir)) {
            // Failing here beats starting a server that answers every page with a placeholder while the
            // user wonders why their build is not showing up.
            throw new Error(`no such assets directory: ${dir}`);
        }
        return { assets: directoryAssets(dir), source: "directory" };
    }

    const built = await embedded();
    if (built !== undefined) return { assets: built, source: "embedded" };

    return { assets: placeholderAssets(), source: "placeholder" };
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

        const { assets, source } = await chooseAssets(args.assets);

        const running = await startMotteServer(config, {
            ...(args.port === undefined ? {} : { port: args.port }),
            assets
        });

        process.stdout.write(
            `\n${ok(`motte is serving ${config.name}`)}\n` +
                `${heading(running.url)}\n\n` +
                `${dim(`  ${config.root}`)}\n`
        );

        if (source === "placeholder") {
            process.stdout.write(
                `\n${warn("the web interface is not built into this binary — the API is live, the pages are a placeholder")}\n` +
                    `${dim("  bun run build:web, or pass --assets <dir>")}\n`
            );
        } else if (source === "directory") {
            process.stdout.write(`\n${dim(`serving the interface from ${args.assets}`)}\n`);
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
