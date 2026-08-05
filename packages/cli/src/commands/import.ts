import type { CommandModule } from "yargs";
import { planImport, type PlannedIssue } from "@motte/core";
import { context, emitJson } from "../context.js";
import { dim, heading, ok, paintId, paintState, warn } from "../ui/format.js";
import { ImportError, fetchIssues, parseRepo } from "../import/github.js";

/**
 * `motte import --github owner/repo`.
 *
 * Nobody starts with an empty tracker. The people most likely to want motte are the ones already carrying a
 * GitHub Issues backlog that feels heavier than the work deserves, and until this existed the path from
 * there to here was copy and paste.
 *
 * One-way, and not a sync. Nothing is written back to GitHub, nothing is remembered for a second run, and
 * importing twice creates everything twice — which is why `--dry-run` exists and why the reference line on
 * each issue links to the original.
 */

interface ImportArgs {
    github?: string;
    state?: string;
    limit?: number;
    label?: string[];
    hierarchy?: boolean;
    dryRun?: boolean;
    json?: boolean;
}

/**
 * The default is deliberately not "everything".
 *
 * A repository with two thousand closed issues would turn a migration into an archaeology exercise. Open
 * work is what somebody moving to motte actually needs on the first day; `--state all` is one flag away.
 */
const DEFAULT_LIMIT = 200;

function describe(planned: PlannedIssue): string {
    const bits = [
        `${dim(`#${planned.source}`)} ${planned.title}`,
        planned.notes.length === 0 ? "" : dim(`  ${planned.notes.length} comment(s)`),
        planned.labels.length === 0 ? "" : dim(`  +${planned.labels.join(" +")}`),
        planned.assignee === undefined ? "" : dim(`  @${planned.assignee}`)
    ];

    return bits.join("");
}

export const importCommand: CommandModule<{}, ImportArgs> = {
    command: "import",
    describe: "Import issues from GitHub into this project",
    builder: (yargs) =>
        yargs
            .option("github", {
                type: "string",
                describe: "The repository to import from, as owner/repo",
                demandOption: true
            })
            .option("state", {
                type: "string",
                choices: ["open", "closed", "all"],
                default: "open",
                describe: "Which issues to bring across"
            })
            .option("limit", {
                type: "number",
                default: DEFAULT_LIMIT,
                describe: "Stop after this many"
            })
            .option("label", {
                type: "array",
                string: true,
                describe: "Only issues with this label (repeatable)"
            })
            .option("hierarchy", {
                type: "boolean",
                default: true,
                describe: "Recreate sub-issues as parent/child (--no-hierarchy to flatten)"
            })
            .option("dry-run", { type: "boolean", describe: "Show what would be created" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: async (args) => {
        const { config, store } = context();
        const repo = parseRepo(args.github ?? "");
        const out = process.stdout;

        const fetched = await fetchIssues({
            repo,
            state: (args.state ?? "open") as "open" | "closed" | "all",
            limit: Math.max(1, args.limit ?? DEFAULT_LIMIT),
            ...(args.label === undefined ? {} : { labels: args.label })
        });

        const plan = planImport(config, fetched.issues, {
            repo,
            hierarchy: args.hierarchy !== false && !fetched.withoutHierarchy
        });

        if (plan.issues.length === 0) {
            if (args.json === true) {
                emitJson({ repo, imported: [], skipped: [] });
                return;
            }
            out.write(`${warn(`no issues to import from ${repo}`)}\n`);
            return;
        }

        /** Said before anything is written, because each one means the import is not the whole picture. */
        const caveats: string[] = [];
        if (fetched.truncated) {
            caveats.push(
                `stopped at ${plan.issues.length}, which is the limit — pass --limit to bring more`
            );
        }
        if (fetched.withoutHierarchy && args.hierarchy !== false) {
            caveats.push(
                fetched.via === "api"
                    ? "sub-issues are not in the REST API payload, so nothing is nested"
                    : "this version of gh does not report sub-issues, so nothing is nested"
            );
        }
        if (plan.hiddenComments > 0) {
            caveats.push(`${plan.hiddenComments} comment(s) GitHub had hidden were left out`);
        }

        if (args.dryRun === true) {
            if (args.json === true) {
                emitJson({
                    repo,
                    via: fetched.via,
                    wouldImport: plan.issues.map((planned) => ({
                        source: planned.source,
                        title: planned.title,
                        state: planned.state,
                        assignee: planned.assignee ?? null,
                        labels: planned.labels,
                        notes: planned.notes.length,
                        parent: planned.parent ?? null
                    })),
                    hierarchy: plan.hierarchy,
                    hiddenComments: plan.hiddenComments,
                    truncated: fetched.truncated
                });
                return;
            }

            out.write(
                `\n${heading(`would import ${plan.issues.length} issue(s) from ${repo}`)}` +
                    ` ${dim(`via ${fetched.via}`)}\n\n`
            );
            for (const planned of plan.issues) {
                out.write(
                    `  ${describe(planned)}  ${paintState(config, planned.state)}` +
                        (planned.parent === undefined ? "" : dim(`  under #${planned.parent}`)) +
                        "\n"
                );
            }
            out.write("\n");
            for (const caveat of caveats) out.write(`${warn(caveat)}\n`);
            out.write(
                `${dim("Nothing was written. This is one-way and not a sync — running it twice imports everything twice.")}\n`
            );
            return;
        }

        /**
         * Created in two passes: everything first, then the parents.
         *
         * A GitHub sub-issue can appear before its parent in the numbering, and `create` refuses a parent
         * that does not exist yet — rightly, since that is how a dangling reference would get in.
         */
        const ids = new Map<number, number>();
        const imported: { source: number; id: number }[] = [];

        for (const planned of plan.issues) {
            const issue = store.adopt({
                title: planned.title,
                description: planned.description,
                state: planned.state,
                ...(planned.assignee === undefined ? {} : { assignee: planned.assignee }),
                labels: planned.labels,
                notes: planned.notes,
                ...(planned.created === undefined ? {} : { created: planned.created }),
                ...(planned.updated === undefined ? {} : { updated: planned.updated })
            });

            ids.set(planned.source, issue.id);
            imported.push({ source: planned.source, id: issue.id });

            if (args.json !== true) {
                out.write(
                    `${ok(`${paintId(issue.id)} ${issue.title}`)} ${dim(`← ${repo}#${planned.source}`)}\n`
                );
            }
        }

        let nested = 0;
        for (const planned of plan.issues) {
            if (planned.parent === undefined) continue;

            const child = ids.get(planned.source);
            const parent = ids.get(planned.parent);
            if (child === undefined || parent === undefined) continue;

            store.setParent(child, parent);
            nested += 1;
        }

        if (args.json === true) {
            emitJson({
                repo,
                via: fetched.via,
                imported,
                nested,
                hiddenComments: plan.hiddenComments,
                truncated: fetched.truncated
            });
            return;
        }

        out.write(
            `\n${ok(`imported ${imported.length} issue(s) from ${repo}`)}` +
                (nested === 0 ? "" : ` ${dim(`${nested} nested under their parents`)}`) +
                "\n"
        );
        for (const caveat of caveats) out.write(`${warn(caveat)}\n`);
        out.write(
            `${dim("One-way: nothing was written back to GitHub, and running this again would import everything again.")}\n` +
                `${dim(`Each issue links to its original. \`motte status\` for where you now stand, \`motte ready\` for what to pick up.`)}\n`
        );
    }
};
