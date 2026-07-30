import type { CommandModule } from "yargs";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../version.js";
import { fetchVerifiedBinary, installBinary, pruneVersions } from "../install/download.js";
import {
    compareVersionsDescending,
    hostTarget,
    installedVersions,
    locateInstall,
    normalizeVersion,
    type BundleInstall
} from "../install/layout.js";
import { resolveLatestVersion } from "../install/releases.js";
import { forgetRecord, readRecord, unwire } from "../install/record.js";
import { emitJson } from "../context.js";
import { dim, ok, warn } from "../ui/format.js";

const INSTALL_HINT =
    "motte is not running from a managed installation, so there is nothing to upgrade in place.\n" +
    "  This happens when running from source, or when the binary was copied somewhere by hand.\n" +
    "  To install a managed copy:\n" +
    "    curl -fsSL https://raw.githubusercontent.com/CodeVachon/motte/main/install.sh | sh";

class NotInstalledError extends Error {
    constructor(message: string = INSTALL_HINT) {
        super(message);
        this.name = "NotInstalledError";
    }
}

function requireInstall(): BundleInstall {
    const install = locateInstall();
    if (install === undefined) throw new NotInstalledError();
    return install;
}

interface CheckRecord {
    lastAttemptAt: number;
    lastSuccessAt?: number;
    latest?: string;
}

function recordCheck(root: string, latest?: string): void {
    const path = join(root, "update-check.json");
    const now = Date.now();

    let previous: CheckRecord = { lastAttemptAt: now };
    if (existsSync(path)) {
        try {
            previous = JSON.parse(readFileSync(path, "utf8")) as CheckRecord;
        } catch {
            // A corrupt cache is not worth failing an upgrade over.
        }
    }

    const record: CheckRecord = {
        ...previous,
        lastAttemptAt: now,
        ...(latest === undefined ? {} : { lastSuccessAt: now, latest })
    };

    try {
        writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    } catch {
        // Best effort — this is a cache, not state anything depends on.
    }
}

interface UpgradeArgs {
    /**
     * Deliberately not named `version`: that key collides with yargs' built-in `--version` flag, and
     * the flag wins, so the positional arrives as the boolean `true`.
     */
    target?: string;
    check?: boolean;
    keep?: number;
    force?: boolean;
    json?: boolean;
}

export const upgradeCommand: CommandModule<{}, UpgradeArgs> = {
    command: "upgrade [target]",
    describe: "Update motte in place, or check whether an update is available",
    builder: (yargs) =>
        yargs
            .positional("target", {
                type: "string",
                describe: "Install this version instead of the newest"
            })
            .option("check", {
                type: "boolean",
                describe: "Report whether an update is available, changing nothing"
            })
            .option("keep", {
                type: "number",
                default: 2,
                describe: "How many versions to keep on disk"
            })
            .option("force", {
                type: "boolean",
                describe: "Reinstall even if already on the target version"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: async (args) => {
        const install = requireInstall();
        const target = hostTarget();

        const wanted =
            args.target === undefined
                ? await (async () => {
                      const latest = await resolveLatestVersion();
                      recordCheck(install.root, latest);
                      return latest;
                  })()
                : normalizeVersion(args.target);

        const current = normalizeVersion(VERSION);
        // Compare semantically rather than by string equality, so `upgrade 0.0.9` is recognised as a
        // downgrade rather than silently treated the same as an upgrade.
        const ordering = compareVersionsDescending(wanted, current);
        const upToDate = ordering === 0;

        if (args.check === true) {
            if (args.json === true) {
                emitJson({
                    current,
                    latest: wanted,
                    upToDate,
                    isDowngrade: ordering > 0,
                    installRoot: install.root,
                    installed: installedVersions(install.versionsDir)
                });
                return;
            }

            process.stdout.write(
                upToDate
                    ? `${ok(`motte ${current} is the newest release`)}\n`
                    : `${ok(`motte ${wanted} is available`)} ${dim(`(you have ${current})`)}\n` +
                          `${dim("  motte upgrade")}\n`
            );
            return;
        }

        if (upToDate && args.force !== true) {
            process.stdout.write(
                `${ok(`already on ${current}`)} ${dim("— pass --force to reinstall")}\n`
            );
            return;
        }

        if (ordering > 0) {
            process.stdout.write(`${warn(`${wanted} is older than the running ${current}`)}\n`);
        }

        process.stdout.write(
            `${dim(`downloading motte ${wanted} for ${target.platform}-${target.arch}...`)}\n`
        );
        const binary = await fetchVerifiedBinary(wanted, target);
        process.stdout.write(`${ok("checksum verified")}\n`);

        installBinary(install.root, wanted, binary, target.platform === "windows");
        process.stdout.write(`${ok(`installed ${wanted}`)}\n`);

        const { removed, keptRunning } = pruneVersions(
            install.versionsDir,
            installedVersions(install.versionsDir),
            args.keep ?? 2,
            install.version
        );

        if (removed.length > 0) {
            process.stdout.write(`${dim(`pruned ${removed.join(", ")}`)}\n`);
        }

        if (keptRunning !== undefined) {
            process.stdout.write(
                `${dim(`kept ${keptRunning} — it is the binary currently running; the next upgrade will remove it`)}\n`
            );
        }

        if (args.json === true) {
            emitJson({
                from: current,
                to: wanted,
                pruned: removed,
                ...(keptRunning === undefined ? {} : { keptRunning }),
                installRoot: install.root
            });
            return;
        }

        process.stdout.write(
            `\n${dim("Open a new shell, or run `motte --version` to confirm.")}\n`
        );
    }
};

interface UninstallArgs {
    yes?: boolean;
    keepCli?: boolean;
    json?: boolean;
}

export const uninstallCommand: CommandModule<{}, UninstallArgs> = {
    command: "uninstall",
    describe: "Remove motte from this machine",
    builder: (yargs) =>
        yargs
            .option("yes", { alias: "y", type: "boolean", describe: "Skip the confirmation" })
            .option("keep-cli", {
                type: "boolean",
                describe: "Remove agent wiring only, leaving the CLI installed"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        // Agent wiring is removed first and independently of the CLI, so --keep-cli works even when
        // motte is not running from a managed installation.
        const wiring = readRecord();
        const unwired = wiring.map(unwire);

        const describeUnwired = () =>
            unwired
                .map((outcome) => {
                    const where = outcome.entry.path ?? outcome.entry.agent;
                    switch (outcome.result) {
                        case "deleted-file":
                            return `${ok(`removed ${where}`)}\n`;
                        case "removed-key":
                            return `${ok(`removed the motte entry from ${where}`)}\n`;
                        case "delegated":
                            return `${warn(`${outcome.entry.agent}: ${outcome.detail}`)}\n`;
                        case "failed":
                            return `${warn(`could not update ${where}: ${outcome.detail}`)}\n`;
                        default:
                            return `${dim(`${where} was already clean`)}\n`;
                    }
                })
                .join("");

        if (args.keepCli === true) {
            if (wiring.length === 0) {
                process.stdout.write(
                    `${dim("no agent wiring was recorded, so there is nothing to remove")}\n` +
                        `${dim("  If you configured an agent by hand, remove the `motte` entry the same way.")}\n`
                );
                return;
            }

            process.stdout.write(describeUnwired());
            forgetRecord();

            if (args.json === true) {
                emitJson({ unwired: unwired.map((o) => ({ ...o.entry, result: o.result })) });
            }
            return;
        }

        const install = requireInstall();
        const binLinks = candidateBinLinks(install.root);

        if (args.yes !== true) {
            process.stdout.write(
                `${warn(`this will remove ${install.root}`)}\n` +
                    binLinks.map((link) => `${dim(`  and the symlink ${link}`)}\n`).join("") +
                    wiring
                        .map(
                            (entry) =>
                                `${dim(`  and motte's entry in ${entry.path ?? entry.agent}`)}\n`
                        )
                        .join("") +
                    `\n${dim("Your projects' .motte/ backlogs are untouched — only the installation is removed.")}\n` +
                    `${dim("Re-run with --yes to proceed.")}\n`
            );
            process.exitCode = 1;
            return;
        }

        process.stdout.write(describeUnwired());

        for (const link of binLinks) rmSync(link, { force: true });
        rmSync(install.root, { recursive: true, force: true });

        if (args.json === true) {
            emitJson({
                removed: [install.root, ...binLinks],
                unwired: unwired.map((o) => ({ ...o.entry, result: o.result }))
            });
            return;
        }

        process.stdout.write(
            `${ok(`removed ${install.root}`)}\n` +
                binLinks.map((link) => `${ok(`removed ${link}`)}\n`).join("") +
                `\n${dim("Project backlogs under .motte/ were not touched.")}\n`
        );
    }
};

/**
 * Symlinks that point into this installation.
 *
 * Only links that actually resolve into `root` are removed. A `motte` on PATH from a different
 * installation, or from a package manager, is not ours to delete.
 */
function candidateBinLinks(root: string): string[] {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const dirs = [process.env.MOTTE_BIN_DIR, join(home, ".local", "bin"), join(home, "bin")].filter(
        (dir): dir is string => dir !== undefined && dir.length > 0
    );

    const links: string[] = [];

    for (const dir of dirs) {
        for (const name of ["motte", "motte.exe"]) {
            const link = join(dir, name);
            if (!existsSync(link)) continue;

            try {
                if (realpathSync(link).startsWith(root)) links.push(link);
            } catch {
                // A broken link resolves nowhere, so it cannot be shown to be ours. Leave it.
            }
        }
    }

    return [...new Set(links)];
}
