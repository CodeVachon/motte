import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class EditorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EditorError";
    }
}

/** Where the edited copy was left when it could not be applied, so the work is recoverable. */
export class EditorRejectedError extends EditorError {
    constructor(
        message: string,
        readonly draftPath: string
    ) {
        super(`${message}\n  your edit is preserved at ${draftPath}`);
        this.name = "EditorRejectedError";
    }
}

/**
 * Resolve the editor the same way git does: an explicit override, then VISUAL, then EDITOR, then a
 * platform default. Falling back rather than erroring means `motte edit` works on a fresh machine
 * where nobody has set the variable yet.
 */
export function resolveEditor(): { command: string; explicit: boolean } {
    const configured =
        process.env.MOTTE_EDITOR?.trim() ||
        process.env.VISUAL?.trim() ||
        process.env.EDITOR?.trim();

    if (configured !== undefined && configured.length > 0) {
        return { command: configured, explicit: true };
    }

    return { command: process.platform === "win32" ? "notepad" : "vi", explicit: false };
}

function quote(path: string): string {
    // Run through a shell so an editor command carrying its own flags — `code -w`, `subl -n -w` —
    // works as written. That means the path has to be quoted for the shell.
    return process.platform === "win32" ? `"${path}"` : `'${path.replace(/'/g, "'\\''")}'`;
}

export interface EditSessionOptions {
    /** Text to put in front of the user. */
    content: string;
    /** Used for the temp filename, so the editor picks the right syntax highlighting. */
    filename: string;
}

/**
 * Put `content` in front of the user in their editor and return what came back.
 *
 * The edit happens on a temp copy rather than the real file, so a failed validation never leaves a
 * broken issue on disk, and `updated` can be bumped by the store instead of relying on the user to
 * remember. Returns undefined when the content came back unchanged.
 */
export function editInEditor(options: EditSessionOptions): { text: string; draftPath: string } {
    const editor = resolveEditor();

    // Only guard the fallback. Launching `vi` without a terminal hangs or garbles the session, but
    // an explicitly configured editor may well be a non-interactive script, and refusing that would
    // block automation for no reason.
    if (!editor.explicit && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        throw new EditorError(
            "no editor configured and this is not a terminal. Set $EDITOR, or pass the field you " +
                "want to change as a flag — see `motte edit --help`."
        );
    }

    const dir = mkdtempSync(join(tmpdir(), "motte-edit-"));
    const draftPath = join(dir, options.filename);
    writeFileSync(draftPath, options.content, "utf8");

    const result = spawnSync(`${editor.command} ${quote(draftPath)}`, {
        shell: true,
        stdio: "inherit"
    });

    if (result.error !== undefined) {
        throw new EditorError(`could not run "${editor.command}": ${result.error.message}`);
    }

    // 127 is the shell's "command not found". Reporting it as an exit status would send someone
    // hunting for a bug in their editor when the real problem is that it is not installed.
    if (result.status === 127) {
        throw new EditorError(
            `"${editor.command}" was not found. Set $EDITOR to an editor that is on your PATH, ` +
                `or pass the field you want to change as a flag — see \`motte edit --help\`.`
        );
    }

    if (result.status !== 0) {
        throw new EditorRejectedError(
            `"${editor.command}" exited with status ${result.status}, so nothing was changed.`,
            draftPath
        );
    }

    return { text: readFileSync(draftPath, "utf8"), draftPath };
}
