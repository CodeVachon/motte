import { IssueStore, loadConfig, type Config } from "@motte/core";

export interface Context {
    config: Config;
    store: IssueStore;
}

/**
 * Load the project for a command. Every command that touches issues goes through here, so config
 * discovery and store construction happen in exactly one place.
 */
export function context(cwd: string = process.cwd()): Context {
    const config = loadConfig(cwd);
    return { config, store: new IssueStore(config) };
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
