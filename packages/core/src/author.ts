import { execFileSync } from "node:child_process";
import type { Author, AuthorType } from "./schema/issue.js";

export interface AuthorOptions {
    /** Explicit name, from a `--author` flag or an MCP client identity. */
    name?: string | undefined;
    /** Explicit type. Defaults to `user` for the CLI and `agent` for MCP. */
    type?: AuthorType | undefined;
    /** Directory to read git config from. */
    cwd?: string | undefined;
}

function gitUserName(cwd: string): string | undefined {
    try {
        const name = execFileSync("git", ["config", "user.name"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
        return name.length > 0 ? name : undefined;
    } catch {
        // No git, not a repo, or no configured user — fall through to the next source.
        return undefined;
    }
}

/**
 * Resolve who is writing a note.
 *
 * Order: explicit option, then `MOTTE_AGENT` (which also implies the agent type), then
 * `MOTTE_AUTHOR`, then `git config user.name`, then `$USER`, then a generic fallback.
 */
export function resolveAuthor(options: AuthorOptions = {}): Author {
    const cwd = options.cwd ?? process.cwd();

    if (options.name !== undefined && options.name.trim().length > 0) {
        return { name: options.name.trim(), type: options.type ?? "user" };
    }

    const agent = process.env.MOTTE_AGENT?.trim();
    if (agent !== undefined && agent.length > 0) {
        return { name: agent, type: options.type ?? "agent" };
    }

    const declared = process.env.MOTTE_AUTHOR?.trim();
    if (declared !== undefined && declared.length > 0) {
        return { name: declared, type: options.type ?? "user" };
    }

    const type = options.type ?? "user";

    return {
        name:
            gitUserName(cwd) ??
            process.env.USER?.trim() ??
            process.env.USERNAME?.trim() ??
            "unknown",
        type
    };
}

/** ISO-8601 with second precision — the format written into note headings and timestamps. */
export function timestamp(at: Date = new Date()): string {
    return `${at.toISOString().slice(0, 19)}Z`;
}
