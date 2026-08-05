import type { CommandModule } from "yargs";
import { searchIssues, type Config, type Hit, type SearchResult } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { openProjects } from "../projects/across.js";
import { bold, dim, heading, issueLine } from "../ui/format.js";

/**
 * `motte find` — search the bodies.
 *
 * `list` filters frontmatter and a ref matches a title fragment, which leaves the descriptions, plans and
 * notes reachable only with `grep -r .motte/issues`. That is the half of the record with the reasoning in
 * it, and the reason the notes are worth writing at all.
 */

interface FindArgs {
    query: string;
    state?: string;
    label?: string;
    assignee?: string;
    hits?: number;
    all?: boolean;
    json?: boolean;
}

/** Where the hit was, in a form a reader can act on. */
function where(hit: Hit): string {
    if (hit.field === "note" && hit.note !== undefined) {
        return `note ${hit.note.at.slice(0, 10)} ${hit.note.author.name}`;
    }

    return `${hit.field}:${hit.lineNumber}`;
}

/** The needle, made visible in the line it was found on. */
function emphasise(line: string, query: string): string {
    const at = line.toLowerCase().indexOf(query.toLowerCase());
    if (at === -1) return line;

    const match = line.slice(at, at + query.length);
    return `${line.slice(0, at)}${bold(match)}${line.slice(at + query.length)}`;
}

function render(config: Config, results: SearchResult[], query: string): string {
    let out = "";

    for (const result of results) {
        out += `${issueLine(config, result.issue)}\n`;

        for (const hit of result.hits) {
            out += `  ${dim(where(hit))}  ${emphasise(hit.line, query)}\n`;
        }

        if (result.total > result.hits.length) {
            out += `  ${dim(`and ${result.total - result.hits.length} more in this issue`)}\n`;
        }
    }

    return out;
}

export const findCommand: CommandModule<{}, FindArgs> = {
    command: "find <query>",
    describe: "Search titles, descriptions, plans and notes",
    builder: (yargs) =>
        yargs
            .positional("query", {
                type: "string",
                demandOption: true,
                describe: "The phrase to look for"
            })
            .option("state", { alias: "s", type: "string", describe: "Only this state" })
            .option("label", {
                alias: "l",
                type: "string",
                describe: "Only issues with this label"
            })
            .option("assignee", { alias: "a", type: "string", describe: "Only this assignee" })
            .option("hits", { type: "number", default: 3, describe: "Matching lines per issue" })
            .option("all", {
                type: "boolean",
                describe: "Across every project on this machine"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const options = {
            filter: { state: args.state, label: args.label, assignee: args.assignee },
            maxHits: Math.max(1, args.hits ?? 3)
        };

        // Before `context()`, because searching every project is a question asked from anywhere — including
        // from a directory that is not a project itself.
        if (args.all === true) {
            findAcross(args, options);
            return;
        }

        const { config, store } = context();
        const results = searchIssues(store.all(), args.query, options);

        if (args.json === true) {
            emitJson({
                query: args.query,
                count: results.length,
                issues: results.map((result) => ({
                    ...issueJson(result.issue),
                    hits: result.hits,
                    totalHits: result.total
                }))
            });
            return;
        }

        if (results.length === 0) {
            process.stdout.write(`${dim(`nothing matches “${args.query}”`)}\n`);
            return;
        }

        process.stdout.write(render(config, results, args.query));
        process.stdout.write(`\n${dim(summary(results))}\n`);
    }
};

function summary(results: SearchResult[]): string {
    const matches = results.reduce((total, result) => total + result.total, 0);

    return (
        `${results.length} issue${results.length === 1 ? "" : "s"}, ` +
        `${matches} match${matches === 1 ? "" : "es"}`
    );
}

/** The same search, over every registered project. */
function findAcross(args: FindArgs, options: Parameters<typeof searchIssues>[2]): void {
    const { projects, unreadable } = openProjects();
    const out = process.stdout;

    const found = projects.map((project) => ({
        project,
        results: searchIssues(project.issues, args.query, options)
    }));

    const total = found.reduce((count, entry) => count + entry.results.length, 0);

    if (args.json === true) {
        emitJson({
            query: args.query,
            count: total,
            projects: found.map((entry) => ({
                name: entry.project.name,
                root: entry.project.root,
                issues: entry.results.map((result) => ({
                    ...issueJson(result.issue),
                    hits: result.hits,
                    totalHits: result.total
                }))
            })),
            unreadable: unreadable.map((project) => ({ name: project.name, root: project.root }))
        });
        return;
    }

    if (total === 0) {
        out.write(`${dim(`nothing matches “${args.query}” in any project`)}\n`);
        return;
    }

    for (const { project, results } of found) {
        if (results.length === 0) continue;

        out.write(`\n${heading(project.name)}\n`);
        out.write(render(project.config, results, args.query));
    }

    const projectCount = found.filter((entry) => entry.results.length > 0).length;
    out.write(
        `\n${dim(`${total} issue${total === 1 ? "" : "s"} in ${projectCount} project${projectCount === 1 ? "" : "s"}`)}\n`
    );
}
