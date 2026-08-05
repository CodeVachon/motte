import { readFileSync } from "node:fs";

/**
 * Free text on the command line, when the text might begin with a dash.
 *
 * `motte note 89 "--fix repairs three findings…"` failed with "Not enough non-option arguments": yargs
 * reads the body as a flag. That is not an edge case here — notes in this project quote flag names
 * constantly — and the workaround was to rephrase the sentence, which is the tool dictating prose.
 *
 * Two ways in, because one is not enough:
 *
 * - `--`, the convention every shell user already knows. It did not work before: yargs leaves the
 *   remainder in `_` but still fails the positional's demand check first, so the positional has to be
 *   declared optional and the value picked back out of `_`.
 * - stdin, which is the right answer for a long note regardless of what it starts with, and the only
 *   answer for one containing newlines.
 *
 * Flag values already had an escape — `-d="--fix is the flag"` parses fine — so this is only about
 * positionals.
 */

/** Everything yargs left over after the command name and the positionals it did fill. */
function remainderOf(argv: readonly (string | number)[]): string[] {
    // `_[0]` is the command name. Anything after it is what `--` protected from the parser.
    return argv.slice(1).map((value) => String(value));
}

export class TextArgError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TextArgError";
    }
}

export interface TextArgOptions {
    /** The positional, if yargs managed to fill it. */
    value: string | undefined;
    /** `argv._`, which holds whatever followed `--`. */
    argv: readonly (string | number)[];
    /** What this text is, for the error: "note body", "title". */
    what: string;
    /** How to ask for it, for the error: "motte note 42". */
    usage: string;
    /** Read stdin when nothing was given on the command line. Off for a one-line value like a title. */
    stdin?: boolean;
}

/**
 * The text the user meant, from wherever they managed to get it past the parser.
 *
 * Refuses when text arrives both ways — `motte note 42 "one" -- "two"` — rather than picking one and
 * dropping the other. Silently discarding something somebody typed is worse than making them say it again.
 */
export function textArg(options: TextArgOptions): string {
    const remainder = remainderOf(options.argv);
    const given = options.value?.length === 0 ? undefined : options.value;

    if (given !== undefined && remainder.length > 0) {
        throw new TextArgError(
            `the ${options.what} was given twice — "${given}" and "${remainder.join(" ")}". ` +
                `Pass one, and put it after \`--\` if it starts with a dash.`
        );
    }

    // Joined with spaces: several tokens after `--` is what an unquoted sentence looks like once the shell
    // has split it, and rejoining is what the user meant.
    if (remainder.length > 0) return remainder.join(" ");
    if (given !== undefined) return given;

    if (options.stdin === true) {
        const piped = readStdin();
        if (piped !== undefined) return piped;
    }

    throw new TextArgError(
        `no ${options.what} given.\n` +
            `  ${options.usage} "the text"\n` +
            `  ${options.usage} -- "--text that starts with a dash"` +
            (options.stdin === true ? `\n  ${options.usage} < file.md` : "")
    );
}

/**
 * Whatever was piped in, or nothing.
 *
 * A TTY means nobody piped anything and reading would hang waiting for the user to type — so this returns
 * undefined there rather than blocking, and the caller reports what it wanted.
 *
 * Read synchronously from fd 0, which is correct because in a shell pipeline fd 0 is blocking: verified
 * against a producer that waits two seconds before writing, and against a body larger than one pipe buffer.
 * The commands here are synchronous throughout, and going async to read one string would turn every caller
 * above this one into a promise.
 *
 * `EAGAIN` is the case the catch is really for. A parent that put fd 0 in non-blocking mode — Node itself
 * does, which is how the in-process tests hit it — makes the read fail rather than wait, and "no data
 * available" is then the same answer as "nothing was piped".
 */
function readStdin(): string | undefined {
    if (process.stdin.isTTY === true) return undefined;

    let raw: string;
    try {
        raw = readFileSync(0, "utf8");
    } catch {
        return undefined;
    }

    const text = raw.trim();
    return text.length === 0 ? undefined : text;
}
