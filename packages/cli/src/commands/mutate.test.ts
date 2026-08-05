import { describe, expect, it } from "vitest";
import { RETRY, initialised, motte, spawnMotte } from "../testing/cli.js";

/**
 * Text that begins with a dash, and text that arrives on stdin.
 *
 * `motte note 89 "--fix repairs three findings…"` failed outright: yargs read the body as a flag. It was
 * found while writing a note about `doctor --fix`, which is exactly when it bites — notes in a project
 * like this quote flag names constantly, and the workaround was to rephrase the sentence.
 *
 * The stdin cases spawn a real process on purpose. Only a process of its own can have its own fd 0; the
 * in-process runner claims a TTY precisely so no test reads the runner's stdin.
 */

async function project(): Promise<string> {
    const root = await initialised();
    await motte(root, ["add", "Something"]);
    return root;
}

describe("text that starts with a dash", () => {
    it("goes through after `--`", async () => {
        const root = await project();

        const run = await motte(root, ["note", "1", "--", "--fix repairs three findings"]);

        expect(run.code).toBe(0);
        expect(bodies(await notesOf(root))).toContain("--fix repairs three findings");
    });

    it("works for a title too", async () => {
        const root = await project();

        const run = await motte(root, ["add", "--", "--fix should do less"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("--fix should do less");
    });

    /**
     * Without `--` yargs still refuses, and that is the right trade: teaching the escape costs one line,
     * while persuading the parser to accept a dashed positional would put every real flag at risk. What
     * was unacceptable was "Unknown argument: fix repairs" and nothing else.
     */
    it("is refused without `--`, but the refusal says what to do", async () => {
        const root = await project();

        const run = await motte(root, ["note", "1", "--fix repairs three findings"]);

        expect(run.code).not.toBe(0);
        expect(run.stderr).toContain("has to come after `--`");
        expect(run.stderr).toContain('-- "--your text"');
    });

    it("says nothing about dashes when the flag really was unknown", async () => {
        const root = await project();

        const run = await motte(root, ["note", "1", "a body", "--nope"]);

        expect(run.code).not.toBe(0);
        expect(run.stderr).toContain("nope");
        expect(run.stderr).not.toContain("has to come after");
    });

    it("refuses text given twice rather than dropping one", async () => {
        const root = await project();

        const run = await motte(root, ["note", "1", "one", "--", "two"]);

        expect(run.code).not.toBe(0);
        expect(run.stderr).toContain("given twice");
        expect(await notesOf(root)).toHaveLength(0);
    });

    it("leaves an ordinary body alone", async () => {
        const root = await project();

        expect((await motte(root, ["note", "1", "An ordinary note."])).code).toBe(0);
        expect(bodies(await notesOf(root))).toContain("An ordinary note.");
    });

    /**
     * A bare `-` appeared to work before and did not: yargs turns it into an empty string, so the old
     * code recorded a note with no body and reported success. Refusing is the fix, not a regression.
     */
    it("refuses a body that is only a dash, instead of recording an empty note", async () => {
        const root = await project();

        const run = await motte(root, ["note", "1", "-"]);

        expect(run.code).not.toBe(0);
        expect(run.stderr).toContain("no note body given");
        expect(await notesOf(root)).toHaveLength(0);
    });

    it("refuses an empty title the same way, rather than creating a nameless issue", async () => {
        const root = await project();

        const run = await motte(root, ["add", "-"]);

        expect(run.code).not.toBe(0);
        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
        ).toHaveLength(1);
    });
});

describe("a note body on stdin", RETRY, () => {
    it("is read when the body is omitted", async () => {
        const root = await project();

        const run = spawnMotte(root, ["note", "1"], {}, "--dry-run is the safety.\n");

        expect(run.code).toBe(0);
        expect(bodies(await notesOf(root))).toContain("--dry-run is the safety.");
    });

    /** The reason stdin is the right answer for a real note: a heredoc keeps its paragraphs. */
    it("keeps the newlines, which an argument cannot carry comfortably", async () => {
        const root = await project();

        spawnMotte(root, ["note", "1"], {}, "First paragraph.\n\nSecond paragraph.\n");

        expect(bodies(await notesOf(root))).toContain("First paragraph.\n\nSecond paragraph.");
    });

    it("is not consulted when a body was given, so nothing is read by surprise", async () => {
        const root = await project();

        spawnMotte(root, ["note", "1", "the argument won"], {}, "the pipe lost");

        expect(bodies(await notesOf(root))).toEqual(["the argument won"]);
    });

    it("reports what it wanted when nothing arrives either way", async () => {
        const root = await project();

        const run = spawnMotte(root, ["note", "1"], {}, "");

        expect(run.code).not.toBe(0);
        expect(run.stderr).toContain("no note body given");
        // All three ways in, since the one they tried did not work.
        expect(run.stderr).toContain('motte note 1 "the text"');
        expect(run.stderr).toContain("-- ");
        expect(run.stderr).toContain("< file.md");
    });
});

interface Note {
    body: string;
}

async function notesOf(root: string): Promise<Note[]> {
    return (await motte(root, ["show", "1", "--json"])).json<{ notes: Note[] }>().notes;
}

function bodies(notes: readonly Note[]): string[] {
    return notes.map((note) => note.body);
}
