import type { CommandModule } from "yargs";
import { padId, type MergePlan } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, ok, paintId } from "../ui/format.js";

/**
 * Fold a duplicate into the issue that keeps the work.
 *
 * Ids come from a directory scan, so two agents working the same backlog file the same thing under two
 * numbers as easily as two branches mint the same number. `renumber` fixes the second problem; this fixes
 * the first, and until it existed the only options were `prune` — which throws the notes away — or leaving
 * both open and confusing every report that counts them.
 *
 * Nothing is destroyed: notes, children, blockers and labels move, the source's own words become a note on
 * the survivor, and its number becomes a tombstone that `motte show` follows.
 */

interface MergeArgs {
    from: string;
    into: string;
    dryRun?: boolean;
    json?: boolean;
}

/**
 * The lines that say what moves, skipping whatever this particular pair does not have.
 *
 * One function rather than two, so a dry run and a real run cannot drift into describing different
 * operations — the whole value of a dry run is that it predicts the run that follows.
 */
function describeMerge(plan: MergePlan): string[] {
    const lines: string[] = [];

    if (plan.notes > 0) lines.push(`${plan.notes} note${plan.notes === 1 ? "" : "s"}`);
    if (plan.keepsBody) lines.push("its description and plan, as a note");
    if (plan.children.length > 0) {
        lines.push(
            `${plan.children.length} child issue${plan.children.length === 1 ? "" : "s"}: ` +
                plan.children.map((child) => `#${padId(child.id)}`).join(", ")
        );
    }
    if (plan.dependents.length > 0) {
        lines.push(
            `${plan.dependents.length} issue${plan.dependents.length === 1 ? "" : "s"} waiting on it: ` +
                plan.dependents.map((issue) => `#${padId(issue.id)}`).join(", ")
        );
    }
    if (plan.blockers.length > 0) {
        lines.push(`blocked by ${plan.blockers.map((id) => `#${padId(id)}`).join(", ")}`);
    }
    if (plan.parent !== undefined) lines.push(`parent #${padId(plan.parent)}`);
    if (plan.labels.length > 0) lines.push(`labels ${plan.labels.join(", ")}`);

    return lines;
}

export const mergeCommand: CommandModule<{}, MergeArgs> = {
    command: "merge <from> <into>",
    describe: "Fold a duplicate issue into the one that keeps the work",
    builder: (yargs) =>
        yargs
            .positional("from", {
                type: "string",
                demandOption: true,
                describe: "The duplicate, which goes"
            })
            .positional("into", {
                type: "string",
                demandOption: true,
                describe: "The issue that keeps the work"
            })
            .option("dry-run", { type: "boolean", describe: "Show what would move" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { store } = context();

        // Resolved before planning so a title fragment works on both sides, and so an ambiguous one fails
        // with the usual message rather than as "no issue #NaN".
        const from = store.resolve(args.from);
        const into = store.resolve(args.into);

        const plan = store.planMerge(from.id, into.id);
        const moves = describeMerge(plan);

        if (args.dryRun === true) {
            if (args.json === true) {
                emitJson({
                    wouldMerge: plan.from.id,
                    into: plan.into.id,
                    notes: plan.notes,
                    keepsBody: plan.keepsBody,
                    children: plan.children.map((child) => child.id),
                    dependents: plan.dependents.map((issue) => issue.id),
                    blockedBy: plan.blockedByAfter,
                    parent: plan.parent ?? null,
                    labels: plan.labels
                });
                return;
            }

            const out = process.stdout;
            out.write(
                `\n${dim("would merge")} ${paintId(plan.from.id)} ${plan.from.title}\n` +
                    `${dim("            into")} ${paintId(plan.into.id)} ${plan.into.title}\n\n`
            );

            if (moves.length === 0) {
                out.write(`${dim("nothing to move — the duplicate is empty")}\n\n`);
            } else {
                out.write(`${dim("moving:")}\n`);
                for (const move of moves) out.write(`  ${move}\n`);
                out.write("\n");
            }
            return;
        }

        const survivor = store.merge(from.id, into.id);

        if (args.json === true) {
            emitJson({ merged: plan.from.id, into: issueJson(survivor) });
            return;
        }

        const out = process.stdout;
        out.write(
            `${ok(`merged ${paintId(plan.from.id)} "${plan.from.title}" into ${paintId(survivor.id)}`)}\n`
        );
        for (const move of moves) out.write(`  ${dim(move)}\n`);
        out.write(
            `\n${dim(`#${padId(plan.from.id)} is gone. \`motte show ${plan.from.id}\` follows it here.`)}\n`
        );
    }
};
