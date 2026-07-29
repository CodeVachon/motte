import type { CommandModule } from "yargs";
import { context, emitJson, issueJson } from "../context.js";
import { issueLine, ok, paintId, paintState } from "../ui/format.js";

interface AddArgs {
    title: string;
    parent?: string;
    description?: string;
    plan?: string;
    state?: string;
    assignee?: string;
    label?: string[];
    json?: boolean;
}

export const addCommand: CommandModule<{}, AddArgs> = {
    command: "add <title>",
    describe: "Create an issue",
    builder: (yargs) =>
        yargs
            .positional("title", { type: "string", demandOption: true, describe: "Issue title" })
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
                describe: "Label (repeatable)"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const parent = args.parent === undefined ? undefined : store.resolve(args.parent).id;

        const issue = store.create({
            title: args.title,
            ...(parent === undefined ? {} : { parent }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.plan === undefined ? {} : { plan: args.plan }),
            ...(args.state === undefined ? {} : { state: args.state }),
            ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
            ...(args.label === undefined ? {} : { labels: args.label })
        });

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`created ${paintId(issue.id)}`)}\n${issueLine(config, issue)}\n`
        );
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
    body: string;
    author?: string;
    agent?: boolean;
    json?: boolean;
}

export const noteCommand: CommandModule<{}, NoteArgs> = {
    command: "note <ref> <body>",
    describe: "Add a note to an issue",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or title fragment"
            })
            .positional("body", { type: "string", demandOption: true, describe: "Note text" })
            .option("author", { type: "string", describe: "Override the author name" })
            .option("agent", {
                type: "boolean",
                describe: "Record the note as authored by an agent"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { store } = context();
        const target = store.resolve(args.ref);

        const issue = store.addNote(target.id, args.body, {
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
                describe: "Replace all labels"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);

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

        const issue = store.update(target.id, {
            ...(args.title === undefined ? {} : { title: args.title }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.plan === undefined ? {} : { plan: args.plan }),
            ...(args.state === undefined ? {} : { state: args.state }),
            ...(parent === undefined ? {} : { parent }),
            ...(assignee === undefined ? {} : { assignee }),
            ...(args.label === undefined ? {} : { labels: args.label })
        });

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`updated ${paintId(issue.id)}`)}\n${issueLine(config, issue)}\n`
        );
    }
};
