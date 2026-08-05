import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fishCompletionPath, isMotteFishCompletion, removeFishCompletion } from "./completions.js";
import { fishScript } from "../completionScripts.js";

/**
 * Removing the one completion script that lives outside motte's own directory.
 *
 * `install.sh` puts the fish script where fish autoloads it, so uninstall has to delete it explicitly —
 * and has to be sure it is motte's first, because the filename alone is not proof.
 */

let home: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "motte-fish-"));
});

afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
});

function put(content: string): string {
    const dir = join(home, "fish", "completions");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "motte.fish");
    writeFileSync(path, content, "utf8");
    return path;
}

describe("fishCompletionPath", () => {
    it("follows XDG_CONFIG_HOME when it is set", () => {
        expect(fishCompletionPath({ XDG_CONFIG_HOME: "/config" })).toBe(
            "/config/fish/completions/motte.fish"
        );
    });

    it("falls back to ~/.config, which is where fish looks by default", () => {
        expect(fishCompletionPath({ HOME: "/home/someone" })).toBe(
            "/home/someone/.config/fish/completions/motte.fish"
        );
    });
});

describe("isMotteFishCompletion", () => {
    it("recognises the script motte generates", () => {
        expect(isMotteFishCompletion(fishScript())).toBe(true);
    });

    it("does not recognise somebody else's completion for motte", () => {
        expect(isMotteFishCompletion("complete -c motte -a 'add show list'\n")).toBe(false);
    });

    /** Both markers, so a wrapper script that merely mentions the protocol is not mistaken for ours. */
    it("wants both markers, not either", () => {
        expect(isMotteFishCompletion("motte --get-yargs-completions $argv")).toBe(false);
        expect(isMotteFishCompletion("set -x MOTTE_COMPLETION_SHELL=fish")).toBe(false);
    });
});

describe("removeFishCompletion", () => {
    it("removes the script it generated", () => {
        const path = put(fishScript());
        process.env.XDG_CONFIG_HOME = home;

        const outcome = removeFishCompletion();

        expect(outcome).toEqual({ path, result: "removed" });
        expect(existsSync(path)).toBe(false);
    });

    it("says nothing was there when nothing was", () => {
        process.env.XDG_CONFIG_HOME = home;

        expect(removeFishCompletion().result).toBe("absent");
    });

    /**
     * Deleting a file somebody else wrote, on the strength of its name, is not a trade an uninstaller gets
     * to make — so this reports instead, and the caller says so.
     */
    it("leaves a file it did not write alone, and says so", () => {
        const mine = "complete -c motte -a 'my own thing'\n";
        const path = put(mine);
        process.env.XDG_CONFIG_HOME = home;

        expect(removeFishCompletion().result).toBe("not-ours");
        expect(readFileSync(path, "utf8")).toBe(mine);
    });
});
