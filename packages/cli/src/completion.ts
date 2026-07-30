import { slugify, type Config, type IssueRef } from "@motte/core";

/**
 * A completion candidate. `description` is shown by zsh alongside the value; bash ignores it.
 */
export interface Candidate {
    value: string;
    description?: string;
}

/** What the dynamic completions are drawn from. Passed in so this stays pure and testable. */
export interface CompletionSource {
    config: Config;
    refs: IssueRef[];
}

/** What kind of value a given argument position expects. */
type Expects = "ref" | "state" | "assignee" | "blocker-of-previous" | "label" | null;

/**
 * Which positionals each command takes. Only commands with *dynamic* values need an entry —
 * yargs already completes command names and flag names on its own.
 */
const POSITIONALS: Record<string, Expects[]> = {
    show: ["ref"],
    edit: ["ref"],
    move: ["ref", "state"],
    assign: ["ref", "assignee"],
    note: ["ref", null],
    tree: ["ref"],
    block: ["ref", "ref"],
    unblock: ["ref", "blocker-of-previous"]
};

/** Flags whose *values* are dynamic, and what they expect. */
const FLAG_VALUES: Record<string, Expects> = {
    "--state": "state",
    "-s": "state",
    "--parent": "ref",
    "-p": "ref",
    "--assignee": "assignee",
    "-a": "assignee",
    "--label": "label",
    "-l": "label"
};

/**
 * Flags that take no value.
 *
 * Needed to count positionals correctly: everything else consumes the following word, so treating
 * that word as a positional would shift the index. Listing the booleans rather than the
 * value-takers is the safer default — a flag missing from here costs one skipped word, while a
 * value-taker missing from a list of value-takers silently miscounts.
 */
const BOOLEAN_FLAGS = new Set([
    "--json",
    "--tree",
    "-t",
    "--open",
    "--ready",
    "--blocked",
    "--epics",
    "--agent",
    "--force",
    "--help",
    "-h",
    "--version"
]);

function isFlag(word: string): boolean {
    return word.startsWith("-");
}

/**
 * Issue candidates.
 *
 * A numeric or empty prefix completes to the id, with the title as the description. Anything else
 * completes to the slug — a value with no spaces, so no shell quoting is involved, and `resolve`
 * matches slug forms for exactly this reason.
 */
function refCandidates(refs: IssueRef[], current: string): Candidate[] {
    const numeric = current === "" || /^\d+$/.test(current);

    return refs.map((ref) => ({
        value: numeric ? String(ref.id) : slugify(ref.title),
        description: numeric
            ? `${ref.title} [${ref.state}]`
            : `#${String(ref.id).padStart(4, "0")} [${ref.state}]`
    }));
}

function distinct(values: (string | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => value !== undefined))].sort();
}

/**
 * Work out what the word being completed should be, given everything before it.
 *
 * `words` is the command line after the program name, excluding the partial word itself.
 */
export function expectedAt(words: string[]): Expects {
    const previous = words[words.length - 1];
    if (previous !== undefined && isFlag(previous)) {
        const expects = FLAG_VALUES[previous];
        if (expects !== undefined) return expects;

        // A value-taking flag we have no dynamic candidates for — `--description`, say. Its value is
        // free text, so offer nothing rather than mistaking the position for a positional.
        if (!BOOLEAN_FLAGS.has(previous)) return null;

        // A boolean flag consumes nothing, so the next word is still a positional. Fall through.
    }

    const command = words.find((word) => !isFlag(word));
    if (command === undefined) return null;

    const positionals = POSITIONALS[command];
    if (positionals === undefined) return null;

    // Count the positionals already supplied after the command, skipping flags and their values.
    let index = 0;
    let seenCommand = false;

    for (let i = 0; i < words.length; i += 1) {
        const word = words[i]!;

        if (!seenCommand) {
            if (word === command) seenCommand = true;
            continue;
        }

        if (isFlag(word)) {
            // Skip the value belonging to this flag, so it is not miscounted as a positional.
            if (!BOOLEAN_FLAGS.has(word) && words[i + 1] !== undefined) i += 1;
            continue;
        }

        index += 1;
    }

    return positionals[index] ?? null;
}

/**
 * Candidates for the word currently being typed, or undefined to let yargs' own completion handle
 * it (command names, flag names).
 */
export function completionCandidates(
    source: CompletionSource,
    words: string[],
    current: string
): Candidate[] | undefined {
    // A partial flag is yargs' business, not ours.
    if (isFlag(current)) return undefined;

    const expects = expectedAt(words);
    if (expects === null) return undefined;

    switch (expects) {
        case "ref":
            return refCandidates(source.refs, current);

        case "state":
            return source.config.states.map((state) => ({
                value: state.name,
                description: state.category
            }));

        case "assignee":
            return [
                ...distinct(source.refs.map((ref) => ref.assignee)).map((name) => ({
                    value: name
                })),
                // `assign <ref> none` is how an assignee is cleared, so offer it.
                { value: "none", description: "clear the assignee" }
            ];

        case "label":
            return distinct(source.refs.flatMap((ref) => ref.labels ?? [])).map((label) => ({
                value: label
            }));

        case "blocker-of-previous": {
            // Only offer blockers the target actually has — anything else is a no-op.
            const command = words.find((word) => !isFlag(word));
            const target = words[words.indexOf(command!) + 1];
            if (target === undefined) return [];

            const issue = findRef(source.refs, target);
            if (issue?.blockedBy === undefined) return [];

            const byId = new Map(source.refs.map((ref) => [ref.id, ref]));
            return issue.blockedBy.map((id) => {
                const blocker = byId.get(id);
                return {
                    value: String(id),
                    description: blocker === undefined ? "missing" : blocker.title
                };
            });
        }
    }
}

/**
 * Resolve a reference the way `IssueStore.resolve` does, but over headers only and without throwing
 * — completion must never fail loudly.
 */
function findRef(refs: IssueRef[], input: string): IssueRef | undefined {
    const trimmed = input.trim();
    if (/^#?\d+$/.test(trimmed)) {
        const id = Number.parseInt(trimmed.replace(/^#/, ""), 10);
        return refs.find((ref) => ref.id === id);
    }

    const needle = trimmed.toLowerCase();
    const needleSlug = slugify(trimmed);

    return (
        refs.find((ref) => ref.title.toLowerCase() === needle) ??
        refs.find((ref) => slugify(ref.title) === needleSlug) ??
        refs.find((ref) => ref.title.toLowerCase().includes(needle)) ??
        refs.find((ref) => slugify(ref.title).includes(needleSlug))
    );
}

/**
 * Format for the shell. zsh reads `value:description` and renders a description column; bash takes
 * the bare value. Colons in a value have to be escaped or zsh would read them as the separator.
 */
export function formatCandidates(candidates: Candidate[], zsh: boolean): string[] {
    return candidates.map((candidate) => {
        if (!zsh) return candidate.value;
        const value = candidate.value.replace(/:/g, "\\:");
        return candidate.description === undefined
            ? value
            : `${value}:${candidate.description.replace(/:/g, " ").replace(/\s+/g, " ")}`;
    });
}

export function isZshShell(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.SHELL?.includes("zsh") ?? false) || (env.ZSH_NAME?.includes("zsh") ?? false);
}

/** The flag the shell scripts use to ask for completions. */
const COMPLETION_FLAG = "--get-yargs-completions";

/**
 * Recover the words the shell actually sent, from the raw process arguments.
 *
 * yargs hands the completion hook a *parsed* argv, which has already consumed flags — so
 * `list --label <TAB>` arrives with `--label` stripped out and there is no way to tell that a flag
 * value is being completed. The raw arguments still have it.
 *
 * The shell passes the program name first, then every word including the partial one.
 */
export function wordsFromArgv(argv: string[], current: string): string[] {
    const start = argv.indexOf(COMPLETION_FLAG);
    if (start === -1) return [];

    // Drop the flag itself and the program name that follows it.
    const words = argv.slice(start + 2);

    // The partial word being completed is not context for itself.
    if (words.length > 0 && words[words.length - 1] === current) words.pop();

    return words;
}
