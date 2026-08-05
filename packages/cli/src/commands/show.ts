import type { CommandModule } from "yargs";
import {
    blocks,
    commitsFor,
    IssueNotFoundError,
    isReady,
    mergedInto,
    openBlockers,
    padId,
    subtreeReport,
    type Issue,
    type IssueStore
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, heading, issueLine, paintId, paintState, progressLine, warn } from "../ui/format.js";

interface ShowArgs {
    ref: string;
    json?: boolean;
}

interface Followed {
    /** The number that was asked for, which no longer exists. */
    from: number;
    at: string;
    by: string;
}

/**
 * The issue the ref names — or, if that number was merged away, the issue that has its work.
 *
 * This is what makes the tombstone worth writing. An old number in a commit message, a branch name or
 * somebody's notes still leads somewhere, instead of `no issue #0090` and a dead end.
 *
 * Only `show` follows. A merged id resolving everywhere would mean `motte move 90 done` silently closing a
 * different issue, and acting on the wrong issue is a worse failure than being told a number is gone.
 */
function follow(store: IssueStore, ref: string): { issue: Issue; followed?: Followed } {
    try {
        return { issue: store.resolve(ref) };
    } catch (error) {
        // Only a bare number can be followed: a title fragment that matches nothing was never an id.
        const asked = Number(ref);
        if (!(error instanceof IssueNotFoundError) || !Number.isInteger(asked)) throw error;

        const events = store.events().events;

        // A chain, because a survivor can itself be merged later. Bounded by the ids already seen, so a
        // log that somehow points in a circle stops rather than spinning.
        const seen = new Set<number>([asked]);
        let tombstone = mergedInto(events, asked);
        let first: Followed | undefined;

        while (tombstone !== undefined) {
            first ??= { from: asked, at: tombstone.at, by: tombstone.by };

            const survivor = store.all().find((issue) => issue.id === tombstone?.into);
            if (survivor !== undefined) return { issue: survivor, followed: first };

            if (seen.has(tombstone.into)) break;
            seen.add(tombstone.into);
            tombstone = mergedInto(events, tombstone.into);
        }

        throw error;
    }
}

export const showCommand: CommandModule<{}, ShowArgs> = {
    command: "show <ref>",
    describe: "Show one issue in full",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or part of its title"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const { issue, followed } = follow(store, args.ref);
        const all = store.all();
        const children = store.children(issue.id);

        if (args.json === true) {
            emitJson({
                ...issueJson(issue),
                mergedFrom:
                    followed === undefined
                        ? null
                        : { id: followed.from, at: followed.at, by: followed.by },
                ready: isReady(config, all, issue),
                openBlockers: openBlockers(config, all, issue).map((blocker) => ({
                    id: blocker.id,
                    title: blocker.title,
                    state: blocker.state
                })),
                blocks: blocks(all, issue.id).map((blocked) => ({
                    id: blocked.id,
                    title: blocked.title,
                    state: blocked.state
                })),
                children: children.map((child) => issueJson(child)),
                progress: children.length === 0 ? null : subtreeReport(config, all, issue.id),
                // Empty in a directory that is not a repository, which is a fact about the directory
                // rather than an error worth reporting.
                commits: commitsFor(config.root, issue.id)
            });
            return;
        }

        const out = process.stdout;

        // Said first, and said plainly: the reader asked for one number and is looking at another.
        if (followed !== undefined) {
            out.write(
                `\n${warn(`#${padId(followed.from)} was merged into ${paintId(issue.id)}`)} ` +
                    `${dim(`by ${followed.by} on ${followed.at.slice(0, 10)}`)}\n`
            );
        }

        out.write(`\n${paintId(issue.id)} ${heading(issue.title)}\n`);

        const waiting = openBlockers(config, all, issue);
        const blocking = blocks(all, issue.id);

        const meta = [paintState(config, issue.state)];
        if (waiting.length > 0) meta.push(warn(`blocked`));
        if (issue.parent !== undefined) meta.push(dim(`parent ${paintId(issue.parent)}`));
        if (issue.assignee !== undefined) meta.push(`@${issue.assignee}`);
        if (issue.labels !== undefined && issue.labels.length > 0) {
            meta.push(issue.labels.map((label) => `+${label}`).join(" "));
        }
        out.write(`${meta.join(dim("  ·  "))}\n`);
        out.write(`${dim(`created ${issue.created}   updated ${issue.updated}`)}\n`);

        if (waiting.length > 0) {
            out.write(`\n${heading("Waiting on")}\n\n`);
            for (const blocker of waiting) out.write(`${issueLine(config, blocker)}\n`);
        }

        if (blocking.length > 0) {
            out.write(`\n${heading("Blocking")}\n\n`);
            for (const dependent of blocking) out.write(`${issueLine(config, dependent)}\n`);
        }

        if (issue.description.length > 0) {
            out.write(`\n${heading("Description")}\n\n${issue.description}\n`);
        }

        if (issue.plan.length > 0) {
            out.write(`\n${heading("Plan")}\n\n${issue.plan}\n`);
        }

        for (const section of issue.unknownSections) {
            if (section.heading === "") continue;
            out.write(`\n${heading(section.heading)}\n\n${section.body}\n`);
        }

        if (children.length > 0) {
            const report = subtreeReport(config, store.all(), issue.id);
            out.write(`\n${heading(`Children (${children.length})`)}\n\n`);
            for (const child of children) out.write(`${issueLine(config, child)}\n`);
            out.write(`\n${progressLine(report)}\n`);
        }

        if (issue.notes.length > 0) {
            out.write(`\n${heading(`Notes (${issue.notes.length})`)}\n`);
            for (const note of issue.notes) {
                const badge = note.author.type === "agent" ? "agent" : "user";
                out.write(`\n${dim(`${note.at}  ${note.author.name} (${badge})`)}\n${note.body}\n`);
            }
        }

        /**
         * The commits that mention it.
         *
         * Last, under the notes, because it is the answer to "what came of this" — and it is the one part of
         * an issue's story that lives in the other record entirely.
         */
        const commits = commitsFor(config.root, issue.id);
        if (commits.length > 0) {
            out.write(`\n${heading(`Commits (${commits.length})`)}\n\n`);
            for (const commit of commits) {
                out.write(
                    `  ${dim(commit.shortSha)}  ${dim(commit.at.slice(0, 10))}  ${commit.subject}\n`
                );
            }
        }

        out.write(`\n${dim(issue.filePath ?? "")}\n`);
    }
};
