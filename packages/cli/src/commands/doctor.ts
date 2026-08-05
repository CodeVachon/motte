import type { CommandModule } from "yargs";
import {
    buildTree,
    dependencyProblems,
    flattenTree,
    idFromFilename,
    isSettled,
    issueFilename,
    padId,
    planRenumber,
    stateCategory,
    timeInState,
    type BrokenEventLine,
    type BrokenFile,
    type Config,
    type Event,
    type Issue
} from "@motte/core";
import { basename } from "node:path";
import { context, emitJson } from "../context.js";
import { dim, error, ok, warn } from "../ui/format.js";

export interface Problem {
    severity: "error" | "warning";
    kind: string;
    message: string;
    file?: string | undefined;
}

/**
 * The checks, one function per family.
 *
 * Split out of the handler, which had accumulated all seven inline at cyclomatic 32 and cognitive 45 —
 * the only function in the project over every threshold at once. Each check was simple; the total was
 * not. They take plain data rather than the store so they can be tested without a project on disk.
 */

/** Files that could not be parsed at all. */
export function unparseableProblems(broken: readonly BrokenFile[]): Problem[] {
    return broken.map((file) => ({
        severity: "error" as const,
        kind: "unparseable",
        message: file.message,
        file: file.filePath
    }));
}

/**
 * Files that parse but would be rewritten if written back.
 *
 * Silent when it happens: the file reads fine, so every other check passes, and the next unrelated write
 * reformats it. Took a label containing a comma reaching CI to notice. `IssueStore.notRoundTrippable`
 * does the comparing; this only phrases it.
 */
export function roundTripProblems(offenders: readonly Issue[]): Problem[] {
    return offenders.map((issue) => ({
        severity: "error" as const,
        kind: "not-round-trippable",
        message:
            `#${issue.id} does not survive a parse/format round trip, so writing to it ` +
            `would reformat the file. Usually a value that needs quoting.`,
        file: issue.filePath
    }));
}

/** Cycles, missing parents and duplicate ids. */
export function hierarchyProblems(issues: readonly Issue[]): Problem[] {
    return buildTree([...issues]).problems.map((problem) => ({
        severity: "error" as const,
        kind: problem.kind,
        message: problem.message,
        file: problem.issues[0]?.filePath
    }));
}

/**
 * Work that has been started for a long time.
 *
 * The check that motivated the event log: #0011 and #0015 sat In Progress after their remaining scope had
 * moved into other issues, and nothing could notice because the files carry no transition history. It
 * needs the log, so it stays quiet when the log is empty rather than reporting every started issue.
 */
export function staleProblems(
    config: Config,
    issues: readonly Issue[],
    events: readonly Event[],
    staleDays: number
): Problem[] {
    if (staleDays <= 0 || events.length === 0) return [];

    const limit = staleDays * 86400_000;
    const problems: Problem[] = [];

    for (const issue of issues) {
        if (stateCategory(config, issue.state) !== "started") continue;

        const inCurrentState = timeInState([...events], issue.id).get(issue.state);
        if (inCurrentState === undefined || inCurrentState < limit) continue;

        problems.push({
            severity: "warning",
            kind: "stale-started",
            message:
                `#${issue.id} has been in "${issue.state}" for ` +
                `${Math.floor(inCurrentState / 86400_000)} days`,
            file: issue.filePath
        });
    }

    return problems;
}

/**
 * Unreadable lines in the event log.
 *
 * A warning, not an error: a corrupt log degrades reporting but invalidates no work, because the issue
 * files remain the source of truth.
 */
export function eventLogProblems(broken: readonly BrokenEventLine[]): Problem[] {
    return broken.map((line) => ({
        severity: "warning" as const,
        kind: "event-log",
        message: `${line.file}${line.line > 0 ? ` line ${line.line}` : ""}: ${line.message}`,
        file: undefined
    }));
}

/** Missing blockers, dependency cycles, and work started while still blocked. */
export function blockerProblems(config: Config, issues: readonly Issue[]): Problem[] {
    return dependencyProblems(config, [...issues]).map((problem) => ({
        // Working on something still blocked is the author's call, not a broken file.
        severity:
            problem.kind === "started-while-blocked" ? ("warning" as const) : ("error" as const),
        kind: problem.kind,
        message: problem.message,
        file: problem.issues[0]?.filePath
    }));
}

/** Ids as `#0007, #0042`, capped so one enormous epic cannot produce an unreadable line. */
function nameIds(issues: readonly Issue[]): string {
    const shown = issues.slice(0, 6).map((issue) => `#${String(issue.id).padStart(4, "0")}`);
    const rest = issues.length - shown.length;

    return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/**
 * Parents whose state disagrees with their subtree, in both directions.
 *
 * Warnings rather than errors: either can be deliberate for a while. But both are quiet, and both have
 * happened here. #0064 was filed under #0005 after #0005 was closed, so the tree reported that epic
 * complete while it carried unstarted work and `status` listed the work under no active epic. The inverse
 * caught #0004, which sat open for four releases after every child of it had settled — the release
 * pipeline was finished and nothing said so.
 *
 * One pass over the tree that `hierarchyProblems` already builds, so an epic with fifty children costs
 * the same as one with two.
 */
export function subtreeProblems(config: Config, issues: readonly Issue[]): Problem[] {
    const problems: Problem[] = [];

    for (const node of flattenTree(buildTree([...issues]).roots)) {
        if (node.children.length === 0) continue;

        const family = flattenTree(node.children).map((child) => child.issue);
        const unsettled = family.filter((issue) => !isSettled(config, issue));
        const settled = isSettled(config, node.issue);

        if (settled && unsettled.length > 0) {
            problems.push({
                severity: "warning",
                kind: "settled-with-open-children",
                message:
                    `#${String(node.issue.id).padStart(4, "0")} is "${node.issue.state}" but ` +
                    `${nameIds(unsettled)} under it ${unsettled.length === 1 ? "is" : "are"} not settled`,
                file: node.issue.filePath
            });
        }

        if (!settled && unsettled.length === 0) {
            problems.push({
                severity: "warning",
                kind: "open-with-settled-children",
                message:
                    `#${String(node.issue.id).padStart(4, "0")} is "${node.issue.state}" but every ` +
                    `issue under it has settled`,
                file: node.issue.filePath
            });
        }
    }

    return problems;
}

/** Per-issue checks: an unconfigured state, a filename that disagrees with the frontmatter, no description. */
export function issueFileProblems(config: Config, issues: readonly Issue[]): Problem[] {
    const problems: Problem[] = [];

    for (const issue of issues) {
        if (stateCategory(config, issue.state) === undefined) {
            problems.push({
                severity: "error",
                kind: "unknown-state",
                message:
                    `#${issue.id} has state "${issue.state}", which is not in the configured ` +
                    `states: ${config.states.map((state) => state.name).join(", ")}`,
                file: issue.filePath
            });
        }

        // A filename whose id prefix disagrees with the frontmatter means a rename went wrong; the
        // frontmatter wins, but the mismatch will confuse anyone reading the directory.
        if (issue.filePath !== undefined) {
            const fromName = idFromFilename(basename(issue.filePath));
            if (fromName === undefined) {
                problems.push({
                    severity: "warning",
                    kind: "filename",
                    message: `${basename(issue.filePath)} does not start with a zero-padded id`,
                    file: issue.filePath
                });
            } else if (fromName !== issue.id) {
                problems.push({
                    severity: "error",
                    kind: "filename",
                    message: `${basename(issue.filePath)} claims #${fromName} but its frontmatter says #${issue.id}`,
                    file: issue.filePath
                });
            }
        }

        if (issue.description.trim().length === 0) {
            problems.push({
                severity: "warning",
                kind: "empty-description",
                message: `#${issue.id} has no description`,
                file: issue.filePath
            });
        }
    }

    return problems;
}

/**
 * The findings with one obvious repair, and nothing else.
 *
 * Three of them: a duplicate id, which `renumber` exists to settle; a filename that disagrees with its
 * frontmatter; and a file that would be rewritten if written back. Each has exactly one right answer, and
 * each already had an implementation elsewhere.
 *
 * Everything else `doctor` reports is a judgement call — a missing parent, a cycle, work started while
 * blocked, a parent that disagrees with its subtree, an issue nobody has touched for a fortnight — and a
 * tool that guesses at those is a tool nobody can trust with the ones it does fix.
 */
export interface Repair {
    kind: "renumbered" | "renamed" | "reformatted";
    message: string;
}

export function repair(
    store: ReturnType<typeof context>["store"],
    options: { dryRun?: boolean } = {}
): Repair[] {
    const repairs: Repair[] = [];
    const moved: string[] = [];

    // Duplicates first: renumbering renames the files it moves, so doing it after the filename pass would
    // leave the pass looking at names that are about to change.
    for (const reassignment of planRenumber(store.all()).reassignments) {
        const from = reassignment.issue.filePath;
        if (from === undefined) continue;

        moved.push(from);

        repairs.push({
            kind: "renumbered",
            message: `#${padId(reassignment.from)} → #${padId(reassignment.to)}  ${reassignment.issue.title}`
        });

        if (options.dryRun !== true) store.renumberFile(from, reassignment.to);
    }

    // Re-read after renumbering: the ids and paths just moved. In a dry run nothing moved, so the files the
    // renumber pass reported are excluded rather than reported twice under a name they no longer will have.
    const alreadyMoving = new Set(moved);
    const candidates = new Set<string>();

    for (const issue of store.notRoundTrippable()) {
        if (issue.filePath !== undefined) candidates.add(issue.filePath);
    }
    for (const issue of store.all()) {
        if (issue.filePath === undefined) continue;
        if (basename(issue.filePath) !== issueFilename(issue.id, issue.title)) {
            candidates.add(issue.filePath);
        }
    }

    for (const filePath of [...candidates].sort()) {
        if (alreadyMoving.has(filePath)) continue;

        const name = basename(filePath);
        const outcome = store.normalise(filePath, { dryRun: options.dryRun === true });

        if (outcome.renamed) {
            repairs.push({ kind: "renamed", message: `${name} → ${basename(outcome.path)}` });
        }
        if (outcome.rewritten) {
            repairs.push({ kind: "reformatted", message: basename(outcome.path) });
        }
    }

    return repairs;
}

/** "1 issue" rather than "1 issues" — `list` already gets this right, `doctor` did not. */
function countIssues(count: number): string {
    return `${count} issue${count === 1 ? "" : "s"}`;
}

/**
 * What was repaired, and a reminder of what was not.
 *
 * The second half matters as much as the first: somebody running `--fix` on a backlog with a cycle in it
 * should not read a list of successful repairs and conclude the cycle is gone.
 */
function renderRepairs(repairs: readonly Repair[], dryRun: boolean): void {
    const out = process.stdout;

    if (repairs.length === 0) {
        out.write(`${dim("nothing to repair mechanically")}\n`);
        return;
    }

    // The kinds are named in the past tense, because that is what they are once applied; a dry run needs
    // the verb instead.
    const verbs = { renumbered: "renumber", renamed: "rename", reformatted: "reformat" } as const;

    for (const entry of repairs) {
        out.write(
            dryRun
                ? `${dim(`would ${verbs[entry.kind]}:`)} ${entry.message}\n`
                : `${ok(entry.message)}\n`
        );
    }

    out.write(
        `\n${dim(dryRun ? "Nothing was changed. Run without --dry-run to apply." : "Anything reported below was left alone — those are judgement calls, not repairs.")}\n\n`
    );
}

function render(problems: readonly Problem[], checked: number): void {
    const out = process.stdout;
    const errors = problems.filter((problem) => problem.severity === "error");
    const warnings = problems.filter((problem) => problem.severity === "warning");

    for (const problem of [...errors, ...warnings]) {
        out.write(
            `${problem.severity === "error" ? error(problem.message) : warn(problem.message)}\n`
        );
        if (problem.file !== undefined) out.write(`  ${dim(problem.file)}\n`);
    }

    if (problems.length === 0) {
        out.write(`${ok(`${countIssues(checked)}, no problems found`)}\n`);
        return;
    }

    out.write(
        `\n${dim(`${countIssues(checked)} checked · ${errors.length} error(s) · ${warnings.length} warning(s)`)}\n`
    );
}

interface DoctorArgs {
    json?: boolean;
    staleAfter?: number;
    fix?: boolean;
    dryRun?: boolean;
}

export const doctorCommand: CommandModule<{}, DoctorArgs> = {
    command: "doctor",
    describe: "Validate the backlog and report every problem found",
    builder: (yargs) =>
        yargs
            .option("stale-after", {
                type: "number",
                default: 7,
                describe: "Warn about work started more than this many days ago (0 disables)"
            })
            .option("fix", {
                type: "boolean",
                describe: "Repair the findings that have one obvious repair"
            })
            .option("dry-run", { type: "boolean", describe: "With --fix, say what would change" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();

        const repairs = args.fix === true ? repair(store, { dryRun: args.dryRun }) : [];

        // Re-read after repairing, so what is reported is the backlog as it now stands rather than as it
        // was before the repairs — the whole point of running the two together.
        const issues = store.all();
        const log = store.events();

        // Order matters to the reader: what is unreadable, then what is malformed, then what is merely
        // worth knowing.
        const problems = [
            ...unparseableProblems(store.brokenFiles()),
            ...roundTripProblems(store.notRoundTrippable()),
            ...hierarchyProblems(issues),
            ...staleProblems(config, issues, log.events, args.staleAfter ?? 7),
            ...eventLogProblems(log.broken),
            ...blockerProblems(config, issues),
            ...subtreeProblems(config, issues),
            ...issueFileProblems(config, issues)
        ];

        const errors = problems.filter((problem) => problem.severity === "error");

        if (args.json === true) {
            emitJson({
                ok: errors.length === 0,
                checked: issues.length,
                ...(args.fix === true
                    ? { [args.dryRun === true ? "wouldRepair" : "repaired"]: repairs }
                    : {}),
                errors,
                warnings: problems.filter((problem) => problem.severity === "warning")
            });
        } else {
            if (args.fix === true) renderRepairs(repairs, args.dryRun === true);
            render(problems, issues.length);
        }

        if (errors.length > 0) process.exitCode = 1;
    }
};
