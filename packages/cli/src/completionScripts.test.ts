import { describe, expect, it } from "vitest";
import {
    COMPLETION_SHELLS,
    completionScript,
    fishScript,
    isCompletionShell,
    powershellScript
} from "./completionScripts.js";

/**
 * The two templates yargs does not provide.
 *
 * A script is only exercised by the shell it is for, and neither shell is available in this test runner —
 * so what is checked here is the handful of things that make it work at all, each of which was either got
 * wrong on the way to a working script or would fail silently if it broke. The end-to-end proof is a real
 * fish and a real pwsh in CI.
 */

describe("the shell list", () => {
    it("covers what install.sh and install.ps1 generate", () => {
        expect([...COMPLETION_SHELLS]).toEqual(["bash", "zsh", "fish", "powershell"]);
    });

    it("recognises only those", () => {
        expect(isCompletionShell("fish")).toBe(true);
        expect(isCompletionShell("nushell")).toBe(false);
        expect(isCompletionShell("")).toBe(false);
    });

    /** bash and zsh come from yargs; asking this module for them is how the caller knows. */
    it("has a template only for the two yargs lacks", () => {
        expect(completionScript("fish")).toBeDefined();
        expect(completionScript("powershell")).toBeDefined();
        expect(completionScript("bash")).toBeUndefined();
        expect(completionScript("zsh")).toBeUndefined();
    });
});

describe("the fish script", () => {
    const script = fishScript();

    it("asks over the same protocol the bash and zsh scripts use", () => {
        expect(script).toContain("--get-yargs-completions");
    });

    /**
     * Nothing about fish can be sniffed — it sets `SHELL` only for a login shell — so the script says who
     * it is. Without this, candidates come back in zsh's `value:description` form and fish inserts the
     * whole thing as one word.
     */
    it("says which shell it is", () => {
        expect(script).toContain("MOTTE_COMPLETION_SHELL=fish");
    });

    it("sends the completed words and the partial one separately", () => {
        expect(script).toContain("commandline -opc");
        expect(script).toContain("commandline -ct");
    });

    /** Without `-f`, fish offers the whole directory listing beside every issue title. */
    it("turns off file completion, which motte never wants", () => {
        expect(script).toMatch(/complete -c motte -f/);
    });

    it("keeps completion quiet when there is no project here", () => {
        // Completion runs on every TAB; an error message from a stray directory would land in the prompt.
        expect(script).toContain("2>/dev/null");
    });

    it("calls the real binary rather than recursing through a function or alias", () => {
        expect(script).toContain("command motte");
    });

    it("names the file it should be saved as", () => {
        expect(script).toContain("~/.config/fish/completions/motte.fish");
    });
});

describe("the PowerShell script", () => {
    const script = powershellScript();

    it("registers a native completer, which is the form for an external command", () => {
        expect(script).toContain("Register-ArgumentCompleter -Native -CommandName motte");
    });

    it("says which shell it is, and puts the variable back afterwards", () => {
        expect(script).toContain("$env:MOTTE_COMPLETION_SHELL = 'powershell'");
        expect(script).toContain("Remove-Item Env:MOTTE_COMPLETION_SHELL");
    });

    it("splits value from description on the tab they arrive separated by", () => {
        expect(script).toContain('-split "`t", 2');
    });

    it("returns CompletionResult objects rather than bare strings", () => {
        expect(script).toContain("[System.Management.Automation.CompletionResult]::new(");
    });

    /** A completer that throws stops TAB working for the rest of the session. */
    it("swallows a failure from the command", () => {
        expect(script).toContain("catch {");
    });

    it("quotes a candidate containing a space, which would otherwise read as two arguments", () => {
        expect(script).toMatch(/if \(\$value -match '\\s'\)/);
    });

    /**
     * PowerShell 5.1 is what a stock Windows has, and it has neither of these. A script using them parses
     * on 7 and fails on 5.1, which is exactly the platform this exists for.
     */
    it("avoids syntax PowerShell 5.1 does not have", () => {
        expect(script).not.toContain("??");
        expect(script).not.toMatch(/\?\s*[^:\s][^:]*\s*:/);
    });

    it("names the profile line that enables it", () => {
        expect(script).toContain("$PROFILE");
    });
});
