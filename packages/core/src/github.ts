import { resolveState, type Config } from "./config.js";
import type { Author, Note } from "./schema/issue.js";

/**
 * Turning a GitHub issue into a motte one.
 *
 * Nobody starts with an empty tracker. The people most likely to want this tool are the ones already
 * carrying a GitHub Issues backlog they find heavier than the work deserves, and until this existed the
 * only path from there to here was copy and paste.
 *
 * Pure: the shape below is what the fetcher produces, whether it came from the `gh` CLI or the REST API,
 * and everything about how a GitHub issue becomes a motte issue is decided here where it can be tested
 * without a network or a token.
 */

/** One issue as the fetcher hands it over, already normalised across the two sources. */
export interface GithubIssue {
    number: number;
    title: string;
    body?: string | null | undefined;
    /** "OPEN" or "CLOSED", in either case. */
    state: string;
    /** "COMPLETED", "NOT_PLANNED", "REOPENED", or nothing. */
    stateReason?: string | null | undefined;
    assignees?: readonly string[] | undefined;
    labels?: readonly string[] | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    comments?: readonly GithubComment[] | undefined;
    /** The parent issue's number, where the repository uses sub-issues. */
    parent?: number | null | undefined;
    url?: string | undefined;
}

export interface GithubComment {
    author?: string | undefined;
    body: string;
    createdAt?: string | undefined;
    /** True for a comment GitHub itself hides — spam, off-topic, or otherwise. */
    minimized?: boolean | undefined;
}

/** One issue to create, with its GitHub number kept for reporting and for resolving parents. */
export interface PlannedIssue {
    /** The number it had on GitHub. Not reused as the motte id — see `referenceLine`. */
    source: number;
    title: string;
    description: string;
    state: string;
    assignee?: string | undefined;
    labels: string[];
    notes: Note[];
    created?: string | undefined;
    updated?: string | undefined;
    /** The GitHub number of its parent, resolved to a motte id once everything has been created. */
    parent?: number | undefined;
}

export interface ImportPlan {
    issues: PlannedIssue[];
    /** Comments GitHub had hidden, which are not imported. Counted rather than dropped in silence. */
    hiddenComments: number;
    /** Sub-issue relationships that will be recreated as parent/child. */
    hierarchy: number;
}

/** A title is required; GitHub cannot produce an empty one, but a hand-made fixture can. */
function titleOf(issue: GithubIssue): string {
    const title = issue.title.trim();
    return title.length === 0 ? `Imported issue #${issue.number}` : title;
}

/**
 * Which state an imported issue lands in.
 *
 * `NOT_PLANNED` is the one worth reading: GitHub distinguishes "closed as completed" from "closed as not
 * planned", and motte has a cancelled category for exactly that difference — work that leaves the
 * denominator rather than counting as finished. Importing both as Done would inflate every progress
 * report from the first day.
 *
 * Falls back by category rather than by name, so a project that renamed Done to Shipped still works.
 */
export function stateFor(config: Config, issue: GithubIssue): string {
    const open = issue.state.toUpperCase() !== "CLOSED";
    if (open) return config.defaultState;

    const notPlanned = (issue.stateReason ?? "").toUpperCase() === "NOT_PLANNED";

    if (notPlanned) {
        const cancelled = config.states.find((state) => state.category === "cancelled");
        if (cancelled !== undefined) return cancelled.name;
    }

    const completed = config.states.find((state) => state.category === "completed");
    // A project with no completed state at all is possible — it is a list of states, and nothing requires
    // one. Better the default state than a name that does not exist.
    return completed?.name ?? config.defaultState;
}

/**
 * Where an imported issue came from, in its own words.
 *
 * The number is a reference in the body rather than the new id. Reusing it would mean colliding with
 * whatever ids the project already has, and a partial import would leave gaps that look like prunes; the
 * link is what somebody actually needs when they want to see the original discussion.
 */
export function referenceLine(repo: string, issue: GithubIssue): string {
    const link = issue.url ?? `https://github.com/${repo}/issues/${issue.number}`;
    return `Imported from [${repo}#${issue.number}](${link}).`;
}

/**
 * Stop an imported body from being read as motte's own sections.
 *
 * `## ` at the start of a line is what divides an issue file into Description, Plan and Notes, and a GitHub
 * body is full of `## ` headings. Left alone, three things happened: `## Notes` turned part of somebody's
 * body into real motte notes attributed to people who never wrote one, `## Plan` moved text into the plan,
 * and — worst — a `## Notes` inside a code fence produced a file motte itself refused to parse, so an issue
 * it had just created came back from `motte list` as a broken file.
 *
 * Demoted a level rather than indented. Indenting also stops the parser and changes nothing visible, but a
 * body whose *first* line is a heading cannot carry it: section content is trimmed on the way in and out, so
 * the leading space vanishes on the next read and the file splits after all. The round-trip test is what
 * caught that. A level deeper survives trimming, stays a heading, and keeps the text exactly.
 *
 * Every `## ` line is demoted, not only the three reserved names: a heading that merely became an "unknown
 * section" lost nothing, but it moved out of the description to the end of the file, which is not what "your
 * body becomes the description" should mean.
 */
export function escapeSections(body: string): string {
    return body
        .split("\n")
        .map((line) => (/^## +\S/.test(line) ? `#${line}` : line))
        .join("\n");
}

function descriptionFor(repo: string, issue: GithubIssue): string {
    const body = escapeSections((issue.body ?? "").trim());
    const reference = referenceLine(repo, issue);

    return body.length === 0 ? reference : `${body}\n\n${reference}`;
}

/**
 * Comments become notes, keeping who wrote them and when.
 *
 * That is the half of a GitHub issue with the reasoning in it, and the half a copy-and-paste migration
 * always loses. Attributed as users: a GitHub login is a person or a bot on somebody's behalf, and motte's
 * "agent" means an agent working through motte itself.
 */
function notesFrom(issue: GithubIssue): { notes: Note[]; hidden: number } {
    const notes: Note[] = [];
    let hidden = 0;

    for (const comment of issue.comments ?? []) {
        // Skipped because GitHub hid it — spam and off-topic are the usual reasons, and importing either
        // into a fresh backlog would be carrying somebody else's noise across. Counted, so the report can
        // say it happened rather than the import quietly deciding for you.
        if (comment.minimized === true) {
            hidden += 1;
            continue;
        }

        const body = comment.body.trim();
        if (body.length === 0) continue;

        const author: Author = { name: comment.author ?? "unknown", type: "user" };
        notes.push({ at: comment.createdAt ?? issue.createdAt ?? "", author, body });
    }

    return { notes, hidden };
}

export interface PlanOptions {
    /** `owner/repo`, for the reference line. */
    repo: string;
    /** Recreate sub-issues as parent/child. On by default; a repository without them is unaffected. */
    hierarchy?: boolean;
}

/**
 * What an import would create.
 *
 * Ordered by GitHub number so the resulting ids run in the same direction as the originals, which is the
 * one thing a reader will look for when comparing the two.
 */
export function planImport(
    config: Config,
    issues: readonly GithubIssue[],
    options: PlanOptions
): ImportPlan {
    const wanted = [...issues].sort((a, b) => a.number - b.number);
    const numbers = new Set(wanted.map((issue) => issue.number));

    const planned: PlannedIssue[] = [];
    let hiddenComments = 0;
    let hierarchy = 0;

    for (const issue of wanted) {
        const { notes, hidden } = notesFrom(issue);
        hiddenComments += hidden;

        // Only a parent that is itself being imported. A sub-issue whose parent lives in another
        // repository, or which the filters left out, becomes a root rather than a dangling reference.
        const parent =
            options.hierarchy !== false &&
            issue.parent !== undefined &&
            issue.parent !== null &&
            numbers.has(issue.parent)
                ? issue.parent
                : undefined;

        if (parent !== undefined) hierarchy += 1;

        // Validated here rather than at write time, so a state name the mapping got wrong fails the plan
        // and the dry run rather than halfway through creating files.
        const state = resolveState(config, stateFor(config, issue)).name;

        planned.push({
            source: issue.number,
            title: titleOf(issue),
            description: descriptionFor(options.repo, issue),
            state,
            // motte holds one assignee; GitHub allows several. The first is the one it records, and the
            // rest are visible in the linked original.
            ...(issue.assignees?.[0] === undefined ? {} : { assignee: issue.assignees[0] }),
            labels: [...new Set(issue.labels ?? [])],
            notes,
            ...(issue.createdAt === undefined ? {} : { created: issue.createdAt }),
            ...(issue.updatedAt === undefined ? {} : { updated: issue.updatedAt }),
            ...(parent === undefined ? {} : { parent })
        });
    }

    return { issues: planned, hiddenComments, hierarchy };
}
