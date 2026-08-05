import type { CommandModule } from "yargs";
import { planRenumber, type Reassignment, type Reference } from "@motte/core";
import { basename } from "node:path";
import { context, emitJson } from "../context.js";
import { dim, ok, paintId, warn } from "../ui/format.js";

/**
 * Repair a duplicated id.
 *
 * The other half of deriving ids from a directory scan: no counter file means no write conflict on every
 * create, and the price is that two branches can each mint #7. `doctor` reports that as an error; until
 * this existed, nothing cleared it — and the ReadMe had been promising this command since 0.1.0.
 *
 * The issue that had the number first keeps it. What moves is whatever was filed later, which gets a fresh
 * id above everything in use, so a renumber never re-uses a number somebody may still have in a branch
 * name or a commit message.
 */

interface RenumberArgs {
    dryRun?: boolean;
    json?: boolean;
}

function describe(reassignment: Reassignment): string {
    const from = paintId(reassignment.from);
    const to = paintId(reassignment.to);
    const file = reassignment.issue.filePath;

    return `${from} → ${to}  ${reassignment.issue.title}${
        file === undefined ? "" : ` ${dim(basename(file))}`
    }`;
}

/** Both halves of a reference, phrased so the reader knows which file to open. */
function describeReference(reference: Reference): string {
    return `${paintId(reference.issue.id)} ${reference.issue.title} — ${reference.via}`;
}

export const renumberCommand: CommandModule<{}, RenumberArgs> = {
    command: "renumber",
    describe: "Give a fresh id to any issue whose number is claimed by another file",
    builder: (yargs) =>
        yargs
            .option("dry-run", { type: "boolean", describe: "Show what would change" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { store } = context();
        const issues = store.all();
        const plan = planRenumber(issues);

        if (plan.reassignments.length === 0) {
            if (args.json === true) {
                emitJson({ renumbered: [], ambiguousReferences: [] });
                return;
            }
            process.stdout.write(`${ok("no duplicate ids")}\n`);
            return;
        }

        if (args.dryRun === true) {
            if (args.json === true) {
                emitJson({
                    wouldRenumber: plan.reassignments.map((reassignment) => ({
                        from: reassignment.from,
                        to: reassignment.to,
                        file: reassignment.issue.filePath ?? null,
                        becomes: reassignment.filename
                    })),
                    ambiguousReferences: plan.ambiguous.map((reference) => ({
                        id: reference.issue.id,
                        via: reference.via
                    }))
                });
                return;
            }

            process.stdout.write(`\n${dim("would renumber:")}\n`);
            for (const reassignment of plan.reassignments) {
                process.stdout.write(`  ${describe(reassignment)}\n`);
            }
            process.stdout.write("\n");
            reportAmbiguous(plan.ambiguous);
            return;
        }

        const renumbered: { from: number; to: number; file: string }[] = [];

        for (const reassignment of plan.reassignments) {
            if (reassignment.issue.filePath === undefined) continue;

            const issue = store.renumberFile(reassignment.issue.filePath, reassignment.to);
            renumbered.push({
                from: reassignment.from,
                to: issue.id,
                file: issue.filePath ?? reassignment.filename
            });

            if (args.json !== true) {
                process.stdout.write(`${ok(describe(reassignment))}\n`);
            }
        }

        if (args.json === true) {
            emitJson({
                renumbered,
                ambiguousReferences: plan.ambiguous.map((reference) => ({
                    id: reference.issue.id,
                    via: reference.via
                }))
            });
            return;
        }

        reportAmbiguous(plan.ambiguous);
    }
};

/**
 * References nobody can reassign for you.
 *
 * When two files both claimed #7, an issue saying `parent: 7` meant one of them and nothing on disk says
 * which. Rewriting it would be guessing at the shape of someone's backlog, so it is reported instead —
 * still pointing at whichever issue kept the number, which is a valid reference rather than a dangling one.
 */
function reportAmbiguous(ambiguous: readonly Reference[]): void {
    if (ambiguous.length === 0) return;

    const out = process.stdout;
    out.write(
        `${warn(`${ambiguous.length} reference(s) pointed at a duplicated id and may now point at the wrong issue:`)}\n`
    );
    for (const reference of ambiguous) {
        out.write(`  ${describeReference(reference)}\n`);
    }
    out.write(
        `\n${dim("Both files claimed the same number, so which one each of these meant is not recorded.")}\n` +
            `${dim("They still point at the issue that kept the id — check them and `motte edit` any that are wrong.")}\n`
    );
}
