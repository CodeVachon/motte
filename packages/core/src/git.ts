import { execFileSync } from "node:child_process";
import { relative } from "node:path";

/**
 * The narrow slice of git that pruning needs.
 *
 * Pruning removes committed files, so the tombstone it leaves has to point at a commit that actually
 * contains them. Everything here exists to make that pointer trustworthy, or to refuse when it cannot
 * be.
 */

export class GitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GitError";
    }
}

function git(cwd: string, args: string[]): string {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"]
        }).trim();
    } catch (error) {
        const stderr =
            typeof error === "object" && error !== null && "stderr" in error
                ? String((error as { stderr?: unknown }).stderr ?? "").trim()
                : "";
        throw new GitError(
            stderr.length > 0
                ? stderr
                : `git ${args[0]} failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function isRepository(cwd: string): boolean {
    try {
        return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
    } catch {
        return false;
    }
}

export function hasCommits(cwd: string): boolean {
    try {
        git(cwd, ["rev-parse", "HEAD"]);
        return true;
    } catch {
        return false;
    }
}

export function headSha(cwd: string, short = true): string {
    return git(cwd, short ? ["rev-parse", "--short", "HEAD"] : ["rev-parse", "HEAD"]);
}

/**
 * Paths under `pathspec` with uncommitted changes, staged or not, including untracked files.
 *
 * Used to refuse a prune on a dirty backlog: the tombstone records HEAD, so if the working tree has
 * changes the recorded commit does not contain the issue's current content and recovery would
 * silently return a stale version.
 */
export function dirtyPaths(cwd: string, pathspec: string): string[] {
    const output = git(cwd, ["status", "--porcelain", "--", pathspec]);
    if (output.length === 0) return [];

    return output
        .split("\n")
        .map(statusPath)
        .filter((path) => path.length > 0);
}

/**
 * The path out of one `git status --porcelain` line.
 *
 * Two status characters, then whitespace, then the path. Slicing a fixed three characters looks
 * equivalent but is not: it ate the leading dot off `.motte/...` whenever the separator ran differently,
 * so the "commit these first" message named a file that did not exist. Dropping the two status
 * characters and then trimming handles every variant.
 */
export function statusPath(line: string): string {
    return line.slice(2).replace(/^\s+/, "").trim();
}

/** File contents at a revision, or undefined when the path is not in that commit. */
export function showAtRevision(cwd: string, revision: string, path: string): string | undefined {
    try {
        return execFileSync("git", ["show", `${revision}:${path}`], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            // A binary-safe read is unnecessary — issue files are UTF-8 Markdown.
            maxBuffer: 16 * 1024 * 1024
        });
    } catch {
        return undefined;
    }
}

export function revisionExists(cwd: string, revision: string): boolean {
    try {
        git(cwd, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

/**
 * The commit that deleted `path`, searched across all refs.
 *
 * The fallback for when a tombstone's recorded commit has been made unreachable by a rebase or a
 * squash. Returns the commit *before* the deletion, since that is the one still holding the content.
 */
export function commitBeforeDeletion(cwd: string, path: string): string | undefined {
    try {
        const deleting = git(cwd, [
            "log",
            "--all",
            "--diff-filter=D",
            "--format=%H",
            "-n",
            "1",
            "--",
            path
        ]);

        if (deleting.length === 0) return undefined;
        return git(cwd, ["rev-parse", "--short", `${deleting}^`]);
    } catch {
        return undefined;
    }
}

/** A path relative to the repository root, which is what `git show rev:path` expects. */
export function repoRelative(cwd: string, absolutePath: string): string {
    const top = git(cwd, ["rev-parse", "--show-toplevel"]);
    return relative(top, absolutePath).split("\\").join("/");
}
