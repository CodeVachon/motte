import { beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitsFor } from "./git.js";

/**
 * The join between an issue and the commits that came out of it.
 *
 * Against a real repository with real commits, not a mocked git. The whole function is an agreement with
 * git's own behaviour — how `--grep` treats a pattern, what `%aI` returns — and a mock would only assert
 * what I believed that agreement to be.
 */

let repo: string;

function git(...args: string[]): void {
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function commit(message: string, file = `${Math.random()}.txt`): void {
    writeFileSync(join(repo, file), "content", "utf8");
    git("add", "-A");
    execFileSync("git", ["commit", "-m", message], {
        cwd: repo,
        stdio: "ignore",
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Chris",
            GIT_AUTHOR_EMAIL: "chris@example.com",
            GIT_COMMITTER_NAME: "Chris",
            GIT_COMMITTER_EMAIL: "chris@example.com"
        }
    });
}

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "motte-git-"));
    git("init", "-q", ".");
    git("config", "user.email", "chris@example.com");
    git("config", "user.name", "Chris");
});

describe("commitsFor", () => {
    it("finds a commit that names the issue", () => {
        commit("Add the parser (#0042)");

        const found = commitsFor(repo, 42);

        expect(found).toHaveLength(1);
        expect(found[0]!.subject).toBe("Add the parser (#0042)");
        expect(found[0]!.author).toBe("Chris");
        expect(found[0]!.shortSha.length).toBeGreaterThan(5);
    });

    /** A person typing by hand writes `#42`; motte prints `#0042`. Both are the same reference. */
    it("finds the unpadded spelling too", () => {
        commit("Closes #42");

        expect(commitsFor(repo, 42)).toHaveLength(1);
    });

    it("does not mistake a longer number for the issue", () => {
        commit("Bump to #421");
        commit("Also #4200");

        expect(commitsFor(repo, 42)).toEqual([]);
    });

    it("does not match a different issue that starts the same", () => {
        commit("Work on #0004");

        expect(commitsFor(repo, 42)).toEqual([]);
    });

    it("finds a reference anywhere in the message, including a trailer", () => {
        commit("A subject with no number\n\nRefs: #0042");

        expect(commitsFor(repo, 42)).toHaveLength(1);
    });

    it("returns the newest first, which is how git reports history", () => {
        commit("First for #0042");
        commit("Second for #0042");

        expect(commitsFor(repo, 42).map((entry) => entry.subject)).toEqual([
            "Second for #0042",
            "First for #0042"
        ]);
    });

    it("caps how many it returns", () => {
        for (let i = 0; i < 5; i += 1) commit(`Change ${i} for #0042`);

        expect(commitsFor(repo, 42, 2)).toHaveLength(2);
    });

    /**
     * git reports the author's local offset. Interleaving that with the UTC timestamps in the event log put
     * a commit four hours before the issue it mentions was created, which reads as impossible rather than as
     * a timezone.
     */
    it("reports the time as UTC, to the second, like everything else in the record", () => {
        commit("Timed #0042");

        expect(commitsFor(repo, 42)[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    describe("when git cannot answer", () => {
        it("finds nothing in a directory that is not a repository", () => {
            expect(commitsFor(mkdtempSync(join(tmpdir(), "motte-plain-")), 42)).toEqual([]);
        });

        /** An issue view has to render in a repository nobody has committed to yet. */
        it("finds nothing in a repository with no commits", () => {
            expect(commitsFor(repo, 42)).toEqual([]);
        });
    });

    it("survives a subject containing the characters it uses as separators", () => {
        // The format uses unit and record separators precisely because a subject can contain anything a
        // person can type — including pipes and tabs, which a printable delimiter would have split on.
        commit("Fix a|b and\tc for #0042");

        expect(commitsFor(repo, 42)[0]!.subject).toBe("Fix a|b and\tc for #0042");
    });
});
