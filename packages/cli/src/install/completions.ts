import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The one completion script that lives outside motte's own directory.
 *
 * `install.sh` drops the fish script into fish's autoload directory, because that is the only shell where
 * enabling completion needs no edit to a file the user owns. Everything else it generates stays under
 * `~/.motte/completions/` and goes when the install root goes.
 *
 * So uninstall has exactly one extra file to think about, and it has to be sure the file is motte's before
 * deleting it — the name alone is not proof, since a user may have written their own.
 */

export function fishCompletionPath(env: NodeJS.ProcessEnv = process.env): string {
    // Every part of the path comes from the environment passed in — reading the home directory from
    // `process.env` while taking XDG_CONFIG_HOME from the argument made the parameter a half-truth, and a
    // test that set only one of them got a path pointing at the developer's own home.
    const configHome = env.XDG_CONFIG_HOME ?? join(env.HOME ?? env.USERPROFILE ?? ".", ".config");
    return join(configHome, "fish", "completions", "motte.fish");
}

/**
 * Whether a file at that path is the script motte generates.
 *
 * Both markers together: the protocol flag alone could appear in somebody's hand-written completion for a
 * different tool that wraps motte, and the variable alone is not much of a fingerprint.
 */
export function isMotteFishCompletion(content: string): boolean {
    return (
        content.includes("MOTTE_COMPLETION_SHELL=fish") &&
        content.includes("--get-yargs-completions")
    );
}

export interface CompletionRemoval {
    path: string;
    result: "removed" | "absent" | "not-ours" | "failed";
    detail?: string;
}

/** Remove the fish script if it is there and it is ours. */
export function removeFishCompletion(env: NodeJS.ProcessEnv = process.env): CompletionRemoval {
    const path = fishCompletionPath(env);

    if (!existsSync(path)) return { path, result: "absent" };

    try {
        if (!isMotteFishCompletion(readFileSync(path, "utf8"))) {
            // Left alone deliberately: deleting a file somebody else wrote, on the strength of its name,
            // is not a trade an uninstaller gets to make.
            return { path, result: "not-ours" };
        }

        rmSync(path, { force: true });
        return { path, result: "removed" };
    } catch (error) {
        return {
            path,
            result: "failed",
            detail: error instanceof Error ? error.message : String(error)
        };
    }
}
