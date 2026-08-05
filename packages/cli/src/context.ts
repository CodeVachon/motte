import { IssueStore, loadConfig, type Config } from "@motte/core";
import { rememberProject, summarise } from "./projects/registry.js";

export interface Context {
    config: Config;
    store: IssueStore;
}

/**
 * Whether to record this run in the per-machine project registry.
 *
 * Off during completion, which runs on every keypress — a TAB is not a visit, and writing a file in the
 * home directory on each one would be both surprising and slow. `MOTTE_NO_INDEX` turns it off entirely,
 * for anyone who would rather motte kept no record outside the repository.
 */
function shouldRegister(): boolean {
    return (
        process.env.MOTTE_NO_INDEX === undefined &&
        !process.argv.includes("--get-yargs-completions")
    );
}

/**
 * The project this process opened, if any.
 *
 * Held so the visit can be recorded when the command has finished rather than when it started — see
 * `registerVisit`.
 */
let visited: Config | undefined;

/**
 * Load the project for a command. Every command that touches issues goes through here, so config
 * discovery and store construction happen in exactly one place.
 *
 * It only notes which project was opened. Summarising happens at the end of the command, because doing it
 * here recorded the backlog as it was *before* the command ran: `motte move 1 done` stored the state
 * without the move, and the registry was permanently one command behind.
 */
export function context(cwd: string = process.cwd()): Context {
    const config = loadConfig(cwd);
    visited = config;

    return { config, store: new IssueStore(config) };
}

/**
 * Record the project this command ran in, with the backlog as the command left it.
 *
 * Called once the command has finished. A fresh store, because the one the command used has a parse cache
 * keyed by mtime and may have been holding readings from before its own writes.
 *
 * Best-effort throughout: a registry that cannot be written must never turn a command that worked into one
 * that failed. It is a convenience built on top of the files, not part of reading them.
 */
export function registerVisit(): void {
    if (visited === undefined || !shouldRegister()) return;

    try {
        const config = visited;
        rememberProject(summarise(config, new IssueStore(config).all()));
    } catch {
        // Deliberately silent, for the reason above.
    } finally {
        visited = undefined;
    }
}

/** Emit JSON on stdout, matching the shape documented for `--json`. */
export function emitJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Strip the derived and internal fields that should not appear in `--json` output.
 *
 * `blockedBy` is part of the contract. It was missing until the CLI smoke tests went in: dependencies
 * landed after this function was written and nothing updated it, so every `--json` response omitted
 * blockers entirely — `motte block 2 1 --json` reported success without showing what it had recorded, and
 * the MCP server's own shape disagreed with this one.
 */
export function issueJson(issue: {
    id: number;
    title: string;
    state: string;
    parent?: number | undefined;
    assignee?: string | undefined;
    labels?: string[] | undefined;
    blockedBy?: number[] | undefined;
    created: string;
    updated: string;
    description: string;
    plan: string;
    notes: { at: string; author: { name: string; type: string }; body: string }[];
    filePath?: string | undefined;
}) {
    return {
        id: issue.id,
        title: issue.title,
        state: issue.state,
        parent: issue.parent ?? null,
        assignee: issue.assignee ?? null,
        labels: issue.labels ?? [],
        blockedBy: issue.blockedBy ?? [],
        created: issue.created,
        updated: issue.updated,
        description: issue.description,
        plan: issue.plan,
        notes: issue.notes,
        file: issue.filePath ?? null
    };
}
