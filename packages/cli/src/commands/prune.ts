import type { CommandModule } from "yargs";
import { readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
    appendEvents,
    commitBeforeDeletion,
    describeSkip,
    dirtyPaths,
    eventsDir,
    hasCommits,
    headSha,
    isRepository,
    parseCutoff,
    planPrune,
    repoRelative,
    resolveAuthor,
    revisionExists,
    showAtRevision,
    stripEventsFor,
    timestamp,
    type Config,
    type Event,
    type Issue
} from "@motte/core";
import { context, emitJson } from "../context.js";
import { dim, heading, ok, paintId, warn } from "../ui/format.js";

class PruneError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PruneError";
    }
}

/**
 * Everything that must be true before removing committed files.
 *
 * The tombstone records HEAD as the place an issue can be recovered from, so all of this exists to make
 * that pointer trustworthy — or to refuse when it cannot be.
 */
function requireCleanRepository(config: Config): string {
    if (!isRepository(config.root)) {
        throw new PruneError(
            "this is not a git repository, so a pruned issue could not be recovered. " +
                "Pruning is only safe where the history it points at exists."
        );
    }

    if (!hasCommits(config.root)) {
        throw new PruneError(
            "this repository has no commits yet, so there is nothing for a tombstone to point at. " +
                "Commit the backlog first."
        );
    }

    const dirty = dirtyPaths(config.root, ".motte");
    if (dirty.length > 0) {
        throw new PruneError(
            "the backlog has uncommitted changes, so a tombstone would point at a commit that does " +
                "not contain them:\n" +
                dirty.map((path) => `    ${path}`).join("\n") +
                "\n  Commit or stash them first, and commit the prune on its own."
        );
    }

    return headSha(config.root);
}

/** Rewrite the shards without the pruned issues' events, then append their tombstones. */
/**
 * Strip every event for `ids` from each shard, deleting a shard that ends up empty. Returns how many
 * event lines went.
 *
 * The one thing `rewriteShards` and `rewriteShardsEventsOnly` genuinely share. They are NOT merged, and
 * must not be: `rewriteShards` goes on to append `pruned` tombstones, and `rewriteShardsEventsOnly`
 * deliberately does not, because `--events-only` strips history while leaving the issues on disk.
 * Writing tombstones there would make `motte restore` offer to restore issues that were never pruned;
 * dropping them from the real prune would break restore entirely and make prune destructive. That
 * guarantee is the whole reason #0058 exists.
 *
 * A missing directory returns 0 rather than throwing, which both callers relied on separately before.
 */
function stripEventsFromShards(dir: string, ids: Set<number>): number {
    let names: string[] = [];
    try {
        names = readdirSync(dir).filter((name) => name.endsWith(".ndjson"));
    } catch {
        // No log to rewrite.
        return 0;
    }

    let removed = 0;

    for (const name of names) {
        const path = join(dir, name);
        const lines = readFileSync(path, "utf8").split("\n");
        const kept = stripEventsFor(lines, ids);

        removed += lines.filter((line) => line.trim().length > 0).length - kept.length;

        if (kept.length === 0) rmSync(path, { force: true });
        else writeFileSync(path, `${kept.join("\n")}\n`, "utf8");
    }

    return removed;
}

function rewriteShards(config: Config, pruned: Issue[], commit: string): number {
    const dir = eventsDir(config.root);
    const removed = stripEventsFromShards(dir, new Set(pruned.map((issue) => issue.id)));

    const author = resolveAuthor({ cwd: config.root });
    const at = timestamp();

    // The tombstones. Deliberately here and not in the shared helper: they are what makes a prune
    // recoverable, and `--events-only` must not write them.
    const tombstones: Event[] = pruned.map((issue) => ({
        at,
        id: issue.id,
        by: author.name,
        as: author.type,
        type: "pruned",
        title: issue.title,
        finalState: issue.state,
        path: repoRelative(config.root, issue.filePath!),
        commit
    }));

    appendEvents(dir, tombstones, author);

    return removed;
}

interface PruneArgs {
    before?: string;
    dryRun?: boolean;
    eventsOnly?: boolean;
    yes?: boolean;
    json?: boolean;
}

export const pruneCommand: CommandModule<{}, PruneArgs> = {
    command: "prune",
    describe: "Remove settled issues past a cutoff, leaving a recoverable tombstone",
    builder: (yargs) =>
        yargs
            .option("before", {
                type: "string",
                // Required on purpose: no default cutoff, so nobody prunes by accident.
                demandOption: true,
                describe: "Cutoff: 2026-01, 2026-01-15, or a span like 90d"
            })
            .option("dry-run", { type: "boolean", describe: "Show what would go, and why" })
            .option("events-only", {
                type: "boolean",
                describe: "Drop the events for settled issues but keep the issues themselves"
            })
            .option("yes", { alias: "y", type: "boolean", describe: "Skip the confirmation" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const cutoff = parseCutoff(args.before!);

        const issues = store.all();
        const { events } = store.events();
        const plan = planPrune(config, issues, events, cutoff);

        if (args.json === true && args.dryRun === true) {
            emitJson({
                cutoff,
                prunable: plan.prunable.map((issue) => ({ id: issue.id, title: issue.title })),
                skipped: plan.skipped.map((entry) => ({
                    id: entry.issue.id,
                    title: entry.issue.title,
                    reason: entry.reason
                }))
            });
            return;
        }

        const out = process.stdout;

        if (args.dryRun === true) {
            out.write(`\n${dim(`cutoff ${cutoff}`)}\n`);

            if (plan.prunable.length === 0) out.write(`\n${dim("nothing is eligible")}\n`);
            else {
                out.write(`\n${heading(`Would prune (${plan.prunable.length})`)}\n\n`);
                for (const issue of plan.prunable) {
                    out.write(`  ${paintId(issue.id)} ${issue.title}\n`);
                }
            }

            // Explaining each skip is what keeps this from being merely frustrating.
            const notable = plan.skipped.filter((entry) => entry.reason.kind !== "not-settled");
            if (notable.length > 0) {
                out.write(`\n${heading("Kept")}\n\n`);
                for (const entry of notable) {
                    out.write(
                        `  ${paintId(entry.issue.id)} ${entry.issue.title}\n` +
                            `      ${dim(describeSkip(entry.reason))}\n`
                    );
                }
            }

            out.write(
                `\n${dim(`${plan.skipped.filter((e) => e.reason.kind === "not-settled").length} unsettled issues were not considered.`)}\n`
            );
            return;
        }

        if (args.eventsOnly === true) {
            /**
             * Eligibility here is only "settled and past the cutoff".
             *
             * The reference check that `planPrune` applies exists to avoid dangling parent and blocker
             * links — and that cannot happen when the issues themselves are staying. Reusing
             * `plan.prunable` would needlessly spare the events of any issue that something still
             * points at.
             */
            const eligible = issues.filter((issue) => {
                const skip = plan.skipped.find((entry) => entry.issue.id === issue.id);
                if (skip === undefined) return true;
                return skip.reason.kind === "referenced";
            });

            const removed = rewriteShardsEventsOnly(config, eligible);

            if (args.json === true) {
                emitJson({ cutoff, removedEvents: removed, issues: eligible.map((i) => i.id) });
                return;
            }

            out.write(
                `${ok(`removed ${removed} event${removed === 1 ? "" : "s"} for ${eligible.length} settled issue${eligible.length === 1 ? "" : "s"}`)}\n` +
                    `${dim("The issues themselves were kept.")}\n`
            );
            return;
        }

        if (plan.prunable.length === 0) {
            out.write(`${dim("nothing is eligible — run with --dry-run to see why")}\n`);
            return;
        }

        const commit = requireCleanRepository(config);

        if (args.yes !== true) {
            out.write(
                `${warn(`this will remove ${plan.prunable.length} issue file${plan.prunable.length === 1 ? "" : "s"} and their events`)}\n`
            );
            for (const issue of plan.prunable) {
                out.write(`  ${paintId(issue.id)} ${issue.title}\n`);
            }
            out.write(
                `\n${dim(`Each will leave a tombstone pointing at ${commit}, so \`motte restore <id>\` can bring it back.`)}\n` +
                    `${dim("Re-run with --yes to proceed, or --dry-run to see what is kept and why.")}\n`
            );
            process.exitCode = 1;
            return;
        }

        const removedEvents = rewriteShards(config, plan.prunable, commit);

        for (const issue of plan.prunable) {
            unlinkSync(issue.filePath!);
        }

        if (args.json === true) {
            emitJson({
                cutoff,
                commit,
                pruned: plan.prunable.map((issue) => ({ id: issue.id, title: issue.title })),
                removedEvents
            });
            return;
        }

        out.write(
            `${ok(`pruned ${plan.prunable.length} issue${plan.prunable.length === 1 ? "" : "s"} and ${removedEvents} event${removedEvents === 1 ? "" : "s"}`)}\n` +
                `${dim(`Recoverable from ${commit} — \`motte restore <id>\`.`)}\n` +
                `\n${dim("Commit this on its own: rewriting the event shards is not an append.")}\n`
        );
    }
};

/** `--events-only`: drop events for settled issues without removing the issues. */
function rewriteShardsEventsOnly(config: Config, settled: Issue[]): number {
    // No tombstones: `--events-only` leaves the issues in place, so there is nothing to restore.
    return stripEventsFromShards(eventsDir(config.root), new Set(settled.map((issue) => issue.id)));
}

interface RestoreArgs {
    id: number;
    json?: boolean;
}

export const restoreCommand: CommandModule<{}, RestoreArgs> = {
    command: "restore <id>",
    describe: "Bring a pruned issue back from its tombstone",
    builder: (yargs) =>
        yargs
            .positional("id", {
                type: "number",
                demandOption: true,
                describe: "The issue number that was pruned"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const { events } = store.events();

        const tombstone = [...events]
            .reverse()
            .find((event) => event.type === "pruned" && event.id === args.id);

        if (tombstone === undefined || tombstone.type !== "pruned") {
            throw new PruneError(
                `no tombstone was found for #${args.id}. ` +
                    `\`motte log --pruned\` lists what can be restored.`
            );
        }

        /**
         * Ids come from `max(existing) + 1`, so pruning the highest-numbered issue frees its number for
         * the next `motte add`. Restoring on top of a live issue would overwrite real work.
         */
        if (store.get(args.id) !== undefined) {
            throw new PruneError(
                `#${args.id} already exists — the number was reused after the prune. ` +
                    `Recover the old content by hand: git show ${tombstone.commit}:${tombstone.path}`
            );
        }

        let revision = tombstone.commit;
        let content = revisionExists(config.root, revision)
            ? showAtRevision(config.root, revision, tombstone.path)
            : undefined;

        if (content === undefined) {
            // A rebase or squash can make the recorded commit unreachable, so fall back to finding the
            // deletion by path.
            const fallback = commitBeforeDeletion(config.root, tombstone.path);
            if (fallback !== undefined) {
                content = showAtRevision(config.root, fallback, tombstone.path);
                if (content !== undefined) revision = fallback;
            }
        }

        if (content === undefined) {
            throw new PruneError(
                `the content of #${args.id} could not be recovered. ` +
                    `${tombstone.commit} is unreachable — history was probably rewritten — and no ` +
                    `deletion of ${tombstone.path} was found on any branch.`
            );
        }

        const path = join(config.issuesPath, basename(tombstone.path));
        writeFileSync(path, content, "utf8");

        const author = resolveAuthor({ cwd: config.root });
        appendEvents(
            eventsDir(config.root),
            [
                {
                    at: timestamp(),
                    id: args.id,
                    by: author.name,
                    as: author.type,
                    type: "restored",
                    commit: revision
                }
            ],
            author
        );

        if (args.json === true) {
            emitJson({ restored: args.id, from: revision, path });
            return;
        }

        process.stdout.write(
            `${ok(`restored ${paintId(args.id)} "${tombstone.title}" from ${revision}`)}\n` +
                `${dim(`  ${path}`)}\n` +
                // Worth saying: a restored issue with no history looks like a bug otherwise.
                `\n${dim("Its own events were removed by the prune — only the tombstone survived, so")}\n` +
                `${dim("`motte log` will show this issue starting from the restore.")}\n`
        );
    }
};

export { PruneError };
