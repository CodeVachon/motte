import type { CommandModule } from "yargs";
import {
    buildTree,
    dependencyProblems,
    idFromFilename,
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

/** "1 issue" rather than "1 issues" — `list` already gets this right, `doctor` did not. */
function countIssues(count: number): string {
    return `${count} issue${count === 1 ? "" : "s"}`;
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
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
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
            ...issueFileProblems(config, issues)
        ];

        const errors = problems.filter((problem) => problem.severity === "error");

        if (args.json === true) {
            emitJson({
                ok: errors.length === 0,
                checked: issues.length,
                errors,
                warnings: problems.filter((problem) => problem.severity === "warning")
            });
        } else {
            render(problems, issues.length);
        }

        if (errors.length > 0) process.exitCode = 1;
    }
};
