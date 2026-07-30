/**
 * The shapes tools return, and the helpers that build them.
 *
 * Split out of server.ts so the tool modules can share them without importing each other.
 */
import { openBlockers, type Config, type Issue } from "@motte/core";

export interface ToolResult {
    // The SDK's callback return type carries an index signature for protocol extensions, so ours has
    // to as well or it is not assignable.
    [key: string]: unknown;
    content: { type: "text"; text: string }[];
    isError?: boolean;
}

export function text(value: unknown): ToolResult {
    return {
        content: [
            {
                type: "text",
                text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
            }
        ]
    };
}

export function failure(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

/** Trimmed issue shape. Sending unknownSections and file paths to an agent is noise. */
export function issueJson(config: Config, issues: Issue[], issue: Issue) {
    return {
        id: issue.id,
        title: issue.title,
        state: issue.state,
        parent: issue.parent ?? null,
        assignee: issue.assignee ?? null,
        labels: issue.labels ?? [],
        blockedBy: issue.blockedBy ?? [],
        openBlockers: openBlockers(config, issues, issue).map((blocker) => blocker.id),
        created: issue.created,
        updated: issue.updated
    };
}

export function fullIssueJson(config: Config, issues: Issue[], issue: Issue) {
    return {
        ...issueJson(config, issues, issue),
        description: issue.description,
        plan: issue.plan,
        notes: issue.notes.map((note) => ({
            at: note.at,
            author: note.author.name,
            authorType: note.author.type,
            body: note.body
        })),
        children: issues
            .filter((candidate) => candidate.parent === issue.id)
            .map((child) => ({ id: child.id, title: child.title, state: child.state }))
    };
}
