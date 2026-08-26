import type { CommandModule } from "yargs";
import { basename } from "node:path";
import {
    formatIssueFile,
    issueFilename,
    parseIssueFile,
    type Config,
    type Issue,
    type IssueStore
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { EditorRejectedError, editInEditor } from "../ui/editor.js";
import { dim, issueLine, ok, paintId, paintState } from "../ui/format.js";
import { textArg } from "../ui/textArg.js";
import { parseFieldArguments } from "../fields.js";
import { promptIssueFields } from "../ui/customFields.js";

/**
 * Report a created or updated issue.
 *
 * Shared by `add` and `edit`, which had identical tails differing only in the verb.
 */
function reportMutation(config: Config, issue: Issue, verb: string, json: boolean): void {
    if (json) {
        emitJson(issueJson(issue));
        return;
    }

    process.stdout.write(`${ok(`${verb} ${paintId(issue.id)}`)}\n${issueLine(config, issue)}\n`);
}

/**
 * Normalise the repeatable `--label` flag.
 *
 * Comma-separated values are split, because `-l cli,testing` is what everyone reaches for and taking
 * it literally produced a single label containing commas — which the frontmatter writer then emitted
 * into an inline list that read back as several labels, breaking the file's round-trip guarantee.
 * Blanks are dropped and duplicates collapsed so `-l a, ,a` cannot write a malformed list either.
 */
function normaliseLabels(values: readonly (string | number)[]): string[] {
    const labels = values
        .flatMap((value) => String(value).split(","))
        .map((label) => label.trim())
        .filter((label) => label.length > 0);

    return [...new Set(labels)];
}

/**
 * `motte edit <ref>` with no field flags: hand the raw Markdown to `$EDITOR`.
 *
 * The edit lands on a temp copy, so an unparseable result never overwrites a good issue. What comes
 * back goes through `store.replace`, which re-derives the filename from the title, revalidates the
 * state, parent and blockers, and bumps `updated` — none of which the user should have to remember.
 */
function editInteractively(store: IssueStore, config: Config, target: Issue, json: boolean): void {
    const original = formatIssueFile(target, config.issueFields ?? []);

    const { text, draftPath } = editInEditor({
        content: original,
        filename: basename(target.filePath ?? issueFilename(target.id, target.title))
    });

    if (text === original) {
        process.stdout.write(`${dim(`no changes to ${paintId(target.id)}`)}\n`);
        return;
    }

    if (text.trim().length === 0) {
        throw new EditorRejectedError(
            `the file came back empty, so ${paintId(target.id)} was left alone. ` +
                `To delete an issue, remove its file.`,
            draftPath
        );
    }

    let edited: Issue;
    try {
        edited = parseIssueFile(text, draftPath, config.issueFields ?? []);
    } catch (thrown) {
        throw new EditorRejectedError(
            `that is not a valid issue file, so nothing was changed.\n  ${
                thrown instanceof Error ? thrown.message : String(thrown)
            }`,
            draftPath
        );
    }

    if (edited.id !== target.id) {
        throw new EditorRejectedError(
            `the id changed from ${target.id} to ${edited.id}. An id is identity, not content — ` +
                `changing it here would fork the issue, so nothing was changed.`,
            draftPath
        );
    }

    // A bad state name, a missing blocker or a cycle all throw from here. Without this, the user's
    // whole edit would be discarded over a typo, with no way back to it.
    let issue: Issue;
    try {
        issue = store.replace(target.id, edited);
    } catch (thrown) {
        throw new EditorRejectedError(
            `${thrown instanceof Error ? thrown.message : String(thrown)}\n  nothing was changed.`,
            draftPath
        );
    }

    if (json) {
        emitJson(issueJson(issue));
        return;
    }

    const renamed = target.filePath !== issue.filePath;
    process.stdout.write(
        `${ok(`updated ${paintId(issue.id)}`)}\n${issueLine(config, issue)}\n` +
            (renamed ? `${dim(`renamed to ${basename(issue.filePath!)}`)}\n` : "")
    );
}

interface AddArgs {
    title?: string;
    _: (string | number)[];
    parent?: string;
    description?: string;
    plan?: string;
    state?: string;
    assignee?: string;
    label?: string[];
    field?: string[];
    json?: boolean;
}

export const addCommand: CommandModule<{}, AddArgs> = {
    // `[title]` rather than `<title>`: a required positional fails its demand check before yargs will
    // take the value from after a `--`, so a title starting with a dash could not be passed at all.
    // `textArg` demands it instead, and can say how to escape it.
    command: "add [title]",
    describe: "Create an issue",
    builder: (yargs) =>
        yargs
            .positional("title", { type: "string", describe: "Issue title" })
            .option("parent", {
                alias: "p",
                type: "string",
                describe: "Parent issue number or title fragment"
            })
            .option("description", { alias: "d", type: "string", describe: "Description body" })
            .option("plan", { type: "string", describe: "Plan body" })
            .option("state", { alias: "s", type: "string", describe: "Initial state" })
            .option("assignee", { alias: "a", type: "string", describe: "Assignee" })
            .option("label", {
                alias: "l",
                type: "array",
                string: true,
                describe: "Label (repeatable, or comma-separated)"
            })
            .option("field", {
                type: "array",
                string: true,
                describe: "Configured frontmatter field as key=value (repeatable)"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: async (args) => {
        const { config, store } = context();
        const parent = args.parent === undefined ? undefined : store.resolve(args.parent).id;

        // No stdin: a title is one line, and a piped title would collide with `-d` reading a description.
        const title = textArg({
            value: args.title,
            argv: args._,
            what: "title",
            usage: "motte add"
        });
        const prompted =
            args.field === undefined
                ? await promptIssueFields(config.issueFields ?? [])
                : undefined;
        if (prompted === null) {
            process.stdout.write(`${dim("issue creation cancelled")}\n`);
            return;
        }
        const fields = parseFieldArguments(config, args.field) ?? prompted;

        const issue = store.create({
            title,
            ...(parent === undefined ? {} : { parent }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.plan === undefined ? {} : { plan: args.plan }),
            ...(args.state === undefined ? {} : { state: args.state }),
            ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
            ...(args.label === undefined ? {} : { labels: normaliseLabels(args.label) }),
            ...(fields === undefined ? {} : { fields })
        });

        reportMutation(config, issue, "created", args.json === true);
    }
};

interface MoveArgs {
    ref: string;
    state: string;
    json?: boolean;
}

export const moveCommand: CommandModule<{}, MoveArgs> = {
    command: "move <ref> <state>",
    describe: "Change an issue's state",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or title fragment"
            })
            .positional("state", { type: "string", demandOption: true, describe: "Target state" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const before = store.resolve(args.ref);
        const issue = store.setState(before.id, args.state);

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`${paintId(issue.id)} ${paintState(config, before.state)} → ${paintState(config, issue.state)}`)}\n`
        );
    }
};

interface NoteArgs {
    ref: string;
    body?: string;
    _: (string | number)[];
    author?: string;
    agent?: boolean;
    json?: boolean;
}

export const noteCommand: CommandModule<{}, NoteArgs> = {
    // `[body]`, for the reason given on `add` — and here it also buys stdin, which is what a note long
    // enough to be worth writing in an editor actually wants.
    command: "note <ref> [body]",
    describe: "Add a note to an issue",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or title fragment"
            })
            .positional("body", {
                type: "string",
                describe: "Note text. Omit to read it from stdin."
            })
            .option("author", { type: "string", describe: "Override the author name" })
            .option("agent", {
                type: "boolean",
                describe: "Record the note as authored by an agent"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { store } = context();
        const target = store.resolve(args.ref);

        const body = textArg({
            value: args.body,
            argv: args._,
            what: "note body",
            usage: `motte note ${args.ref}`,
            stdin: true
        });

        const issue = store.addNote(target.id, body, {
            ...(args.author === undefined ? {} : { name: args.author }),
            ...(args.agent === true ? { type: "agent" as const } : {})
        });

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        const note = issue.notes[issue.notes.length - 1]!;
        process.stdout.write(
            `${ok(`noted on ${paintId(issue.id)} as ${note.author.name} (${note.author.type})`)}\n`
        );
    }
};

interface AssignArgs {
    ref: string;
    who: string;
    json?: boolean;
}

export const assignCommand: CommandModule<{}, AssignArgs> = {
    command: "assign <ref> <who>",
    describe: 'Assign an issue (use "none" to clear)',
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or title fragment"
            })
            .positional("who", {
                type: "string",
                demandOption: true,
                describe: 'Assignee, or "none"'
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);
        const clear = args.who.toLowerCase() === "none";
        const issue = store.assign(target.id, clear ? null : args.who);

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(clear ? `unassigned ${paintId(issue.id)}` : `assigned ${paintId(issue.id)} to ${args.who}`)}\n` +
                `${issueLine(config, issue)}\n`
        );
    }
};

interface EditArgs {
    ref: string;
    title?: string;
    description?: string;
    plan?: string;
    state?: string;
    assignee?: string;
    parent?: string;
    label?: string[];
    field?: string[];
    json?: boolean;
}

export const editCommand: CommandModule<{}, EditArgs> = {
    command: "edit <ref>",
    describe: "Edit an issue's fields",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or title fragment"
            })
            .option("title", { type: "string", describe: "New title" })
            .option("description", {
                alias: "d",
                type: "string",
                describe: "Replace the description"
            })
            .option("plan", { type: "string", describe: "Replace the plan" })
            .option("state", { alias: "s", type: "string", describe: "New state" })
            .option("assignee", { alias: "a", type: "string", describe: 'New assignee, or "none"' })
            .option("parent", {
                alias: "p",
                type: "string",
                describe: 'New parent, or "none" to make it a root'
            })
            .option("label", {
                alias: "l",
                type: "array",
                string: true,
                describe: "Replace all labels (repeatable, or comma-separated)"
            })
            .option("field", {
                type: "array",
                string: true,
                describe:
                    "Set configured frontmatter field as key=value; key= clears an optional field"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);

        // No field flags means "let me edit the whole thing" rather than "change nothing" — an
        // empty patch would otherwise be a silent no-op write that only bumped `updated`.
        const flags = [
            args.title,
            args.description,
            args.plan,
            args.state,
            args.assignee,
            args.parent,
            args.label,
            args.field
        ];
        if (flags.every((flag) => flag === undefined)) {
            editInteractively(store, config, target, args.json === true);
            return;
        }

        const parent =
            args.parent === undefined
                ? undefined
                : args.parent.toLowerCase() === "none"
                  ? null
                  : store.resolve(args.parent).id;

        const assignee =
            args.assignee === undefined
                ? undefined
                : args.assignee.toLowerCase() === "none"
                  ? null
                  : args.assignee;
        const fields = parseFieldArguments(config, args.field, { allowClear: true });

        const issue = store.update(target.id, {
            ...(args.title === undefined ? {} : { title: args.title }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.plan === undefined ? {} : { plan: args.plan }),
            ...(args.state === undefined ? {} : { state: args.state }),
            ...(parent === undefined ? {} : { parent }),
            ...(assignee === undefined ? {} : { assignee }),
            ...(args.label === undefined ? {} : { labels: normaliseLabels(args.label) }),
            ...(fields === undefined ? {} : { fields })
        });

        reportMutation(config, issue, "updated", args.json === true);
    }
};
