import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorError, EditorRejectedError, editInEditor, resolveEditor } from "./editor.js";

const VARS = ["MOTTE_EDITOR", "VISUAL", "EDITOR"] as const;

describe("resolveEditor", () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
        for (const name of VARS) delete process.env[name];
    });

    afterEach(() => {
        for (const name of VARS) {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        }
    });

    it("prefers MOTTE_EDITOR over VISUAL and EDITOR", () => {
        process.env.EDITOR = "ed";
        process.env.VISUAL = "vim";
        process.env.MOTTE_EDITOR = "code -w";

        expect(resolveEditor()).toEqual({ command: "code -w", explicit: true });
    });

    it("prefers VISUAL over EDITOR", () => {
        process.env.EDITOR = "ed";
        process.env.VISUAL = "vim";

        expect(resolveEditor().command).toBe("vim");
    });

    it("falls back to a platform default rather than erroring", () => {
        const resolved = resolveEditor();

        expect(resolved.explicit).toBe(false);
        expect(resolved.command).toBe(process.platform === "win32" ? "notepad" : "vi");
    });

    it("ignores an empty or whitespace-only setting", () => {
        process.env.EDITOR = "   ";
        expect(resolveEditor().explicit).toBe(false);
    });
});

describe("editInEditor", () => {
    let dir: string;
    let saved: string | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "motte-editor-test-"));
        saved = process.env.MOTTE_EDITOR;
    });

    afterEach(() => {
        if (saved === undefined) delete process.env.MOTTE_EDITOR;
        else process.env.MOTTE_EDITOR = saved;
    });

    /** A stand-in for an editor: a shell script that mutates the file it is handed. */
    function fakeEditor(body: string): string {
        const path = join(dir, `editor-${Math.abs(hash(body))}.sh`);
        writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
        chmodSync(path, 0o755);
        return path;
    }

    function hash(text: string): number {
        let out = 0;
        for (const char of text) out = (out * 31 + char.charCodeAt(0)) | 0;
        return out;
    }

    it("returns what the editor wrote", () => {
        process.env.MOTTE_EDITOR = fakeEditor('printf "edited\\n" > "$1"');

        const result = editInEditor({ content: "original\n", filename: "0001-x.md" });

        expect(result.text).toBe("edited\n");
    });

    it("hands the editor the original content, not an empty file", () => {
        process.env.MOTTE_EDITOR = fakeEditor('cat "$1" > "$1.seen"');

        const result = editInEditor({ content: "original\n", filename: "0001-x.md" });

        expect(readFileSync(`${result.draftPath}.seen`, "utf8")).toBe("original\n");
    });

    it("edits a temp copy, so the caller's file is never the one open", () => {
        process.env.MOTTE_EDITOR = fakeEditor('printf "edited\\n" > "$1"');

        const result = editInEditor({ content: "original\n", filename: "0001-x.md" });

        expect(result.draftPath).not.toBe(join(dir, "0001-x.md"));
        expect(result.draftPath).toContain("0001-x.md");
    });

    it("throws with the draft path when the editor exits non-zero", () => {
        process.env.MOTTE_EDITOR = fakeEditor("exit 3");

        try {
            editInEditor({ content: "original\n", filename: "0001-x.md" });
            expect.unreachable("should have thrown");
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(EditorRejectedError);
            // The work has to be recoverable — the message names where it was left.
            expect((thrown as EditorRejectedError).draftPath).toContain("0001-x.md");
            expect((thrown as Error).message).toContain("status 3");
            expect((thrown as Error).message).toContain("preserved at");
        }
    });

    it("says an editor is not installed rather than reporting exit status 127", () => {
        process.env.MOTTE_EDITOR = "definitely-not-an-editor-on-this-machine";

        try {
            editInEditor({ content: "x", filename: "0001-x.md" });
            expect.unreachable("should have thrown");
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(EditorError);
            expect((thrown as Error).message).toContain("was not found");
            expect((thrown as Error).message).not.toContain("127");
            // Not a rejected-edit: there was no edit to preserve.
            expect(thrown).not.toBeInstanceOf(EditorRejectedError);
        }
    });

    it("survives an editor command carrying its own flags", () => {
        // `EDITOR="code -w"` is common, so the command must go through a shell.
        process.env.MOTTE_EDITOR = `${fakeEditor('printf "flagged\\n" > "$2"')} --some-flag`;

        expect(editInEditor({ content: "original\n", filename: "0001-x.md" }).text).toBe(
            "flagged\n"
        );
    });

    it("handles a filename containing a space", () => {
        process.env.MOTTE_EDITOR = fakeEditor('printf "spaced\\n" > "$1"');

        expect(editInEditor({ content: "original\n", filename: "0001 with space.md" }).text).toBe(
            "spaced\n"
        );
    });
});
