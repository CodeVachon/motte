import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { join } from "node:path";
import { resolveAuthor, timestamp, type AuthorOptions } from "./author.js";
import { resolveState, stateCategory, type Config } from "./config.js";
import { blocked, blocks, findDependencyCycle, isSettled, ready } from "./deps.js";
import {
    appendEvents,
    eventsDir,
    readEvents,
    transitionsBetween,
    type ReadResult
} from "./events.js";
import { readIssueRef, type IssueRef } from "./frontmatter.js";
import { mergedBody, planMerge, type MergePlan } from "./merge.js";
import { formatIssueFile, IssueParseError, parseIssueFile } from "./serialize.js";
import { issueFilename, padId, slugify } from "./slug.js";
import type { Author, Issue, IssuePatch, NewIssue, Note } from "./schema/issue.js";

export class IssueNotFoundError extends Error {
    constructor(readonly ref: string | number) {
        super(`no issue matching "${ref}"`);
        this.name = "IssueNotFoundError";
    }
}

export class AmbiguousRefError extends Error {
    constructor(
        readonly ref: string,
        readonly candidates: Issue[]
    ) {
        super(
            `"${ref}" matches ${candidates.length} issues: ` +
                candidates.map((issue) => `#${issue.id} ${issue.title}`).join(", ")
        );
        this.name = "AmbiguousRefError";
    }
}

/**
 * Somebody else holds the issue.
 *
 * Its own error type because refusing is the point: a caller has to be able to tell "taken" apart from
 * "missing" or "malformed" and try the next issue instead of failing.
 */
export class ClaimedError extends Error {
    constructor(
        readonly id: number,
        readonly holder: string
    ) {
        super(`#${padId(id)} is already claimed by ${holder}`);
        this.name = "ClaimedError";
    }
}

export class CycleError extends Error {
    constructor(readonly path: number[]) {
        super(`that would create a cycle: ${path.map((id) => `#${id}`).join(" → ")}`);
        this.name = "CycleError";
    }
}

export class DependencyCycleError extends Error {
    constructor(readonly path: number[]) {
        super(
            `that would create a dependency cycle, so nothing in it could ever be ready: ` +
                path.map((id) => `#${id}`).join(" → ")
        );
        this.name = "DependencyCycleError";
    }
}

/** A file in the issues directory that could not be read as an issue. */
export interface BrokenFile {
    filePath: string;
    message: string;
}

export class IssueStore {
    private cache = new Map<string, { mtimeMs: number; issue: Issue }>();
    private broken: BrokenFile[] = [];

    /**
     * @param author Who to attribute recorded transitions to. The CLI leaves this unset and gets the
     * git user; the MCP server passes the connecting agent, so the log distinguishes the two.
     */
    constructor(
        readonly config: Config,
        private readonly author?: Author
    ) {}

    // ---------------------------------------------------------------- reading

    /**
     * Read every issue from disk. Parses are cached by mtime, so repeated calls in a long-lived
     * process (`motte serve`, the MCP server) only re-parse what actually changed.
     */
    all(): Issue[] {
        if (!existsSync(this.config.issuesPath)) {
            this.broken = [];
            return [];
        }

        const broken: BrokenFile[] = [];
        const issues: Issue[] = [];
        const seenPaths = new Set<string>();

        for (const name of readdirSync(this.config.issuesPath).sort()) {
            if (!name.endsWith(".md")) continue;

            const filePath = join(this.config.issuesPath, name);
            seenPaths.add(filePath);

            let mtimeMs: number;
            try {
                mtimeMs = statSync(filePath).mtimeMs;
            } catch (error) {
                broken.push({
                    filePath,
                    message: error instanceof Error ? error.message : String(error)
                });
                continue;
            }

            const cached = this.cache.get(filePath);
            if (cached && cached.mtimeMs === mtimeMs) {
                issues.push(cached.issue);
                continue;
            }

            try {
                const issue = parseIssueFile(readFileSync(filePath, "utf8"), filePath);
                this.cache.set(filePath, { mtimeMs, issue });
                issues.push(issue);
            } catch (error) {
                this.cache.delete(filePath);
                broken.push({
                    filePath,
                    message:
                        error instanceof IssueParseError || error instanceof Error
                            ? error.message
                            : String(error)
                });
            }
        }

        for (const path of this.cache.keys()) {
            if (!seenPaths.has(path)) this.cache.delete(path);
        }

        this.broken = broken;
        return issues.sort((a, b) => a.id - b.id);
    }

    /** Files that failed to parse on the last `all()`. Surfaced by `motte doctor`. */
    brokenFiles(): BrokenFile[] {
        this.all();
        return [...this.broken];
    }

    /**
     * Issues whose file would change if written back unmodified.
     *
     * The format's one hard guarantee is that parse-then-format is a no-op, and a violation is
     * silent: the file parses, so every check passes, and then the next unrelated write reformats it.
     * This exists because a label containing a comma was emitted bare into an inline list and read
     * back as several labels — noticed only by the round-trip test over this project's own backlog,
     * in CI, after a push. Surfaced by `motte doctor`.
     */
    notRoundTrippable(): Issue[] {
        return this.all().filter((issue) => {
            if (issue.filePath === undefined) return false;

            try {
                return formatIssueFile(issue) !== readFileSync(issue.filePath, "utf8");
            } catch {
                // Vanished between listing and reading. `brokenFiles` is where read errors belong.
                return false;
            }
        });
    }

    /**
     * Headers only — id, title, state, assignee, labels, blockers — without touching any body.
     *
     * For latency-sensitive reads like tab completion, which fires on every keystroke and needs
     * nothing below the frontmatter. Reads a bounded chunk per file instead of the whole thing.
     *
     * Already-parsed issues come from the cache rather than being re-read, so this is never slower
     * than what is already in memory. Unparseable files are skipped silently: completion must never
     * spill an error into the user's shell, and `motte doctor` is where problems get reported.
     */
    refs(): IssueRef[] {
        if (!existsSync(this.config.issuesPath)) return [];

        const refs: IssueRef[] = [];

        for (const name of readdirSync(this.config.issuesPath).sort()) {
            if (!name.endsWith(".md")) continue;
            const filePath = join(this.config.issuesPath, name);

            try {
                const cached = this.cache.get(filePath);
                if (cached && cached.mtimeMs === statSync(filePath).mtimeMs) {
                    refs.push({ ...cached.issue, filePath });
                    continue;
                }

                refs.push(readIssueRef(filePath));
            } catch {
                // Skipped by design — see the note above.
            }
        }

        return refs.sort((a, b) => a.id - b.id);
    }

    get(id: number): Issue | undefined {
        return this.all().find((issue) => issue.id === id);
    }

    require(id: number): Issue {
        const issue = this.get(id);
        if (!issue) throw new IssueNotFoundError(id);
        return issue;
    }

    /**
     * Resolve a user-supplied reference: a number is an id, anything else matches the title.
     *
     * Matching is tried in order of decreasing precision — exact title, exact slug, then substring
     * of either. Exact beats substring so a short title stays addressable even when it appears
     * inside a longer one.
     *
     * The slug forms matter because a hyphenated fragment is not a substring of a spaced title:
     * `reader-for-latency` does not appear in "Frontmatter-only reader for latency-sensitive reads",
     * but it does in the slug. That is what lets tab completion insert a slug — a value with no
     * spaces, which shells handle without quoting — and have it still resolve.
     */
    resolve(ref: string | number): Issue {
        if (typeof ref === "number") return this.require(ref);

        const trimmed = ref.trim();
        if (/^#?\d+$/.test(trimmed)) {
            return this.require(Number.parseInt(trimmed.replace(/^#/, ""), 10));
        }

        const needle = trimmed.toLowerCase();
        const needleSlug = slugify(trimmed);
        const issues = this.all();

        const attempts = [
            (issue: Issue) => issue.title.toLowerCase() === needle,
            (issue: Issue) => slugify(issue.title) === needleSlug,
            (issue: Issue) => issue.title.toLowerCase().includes(needle),
            (issue: Issue) => slugify(issue.title).includes(needleSlug)
        ].map((predicate) => issues.filter(predicate));

        for (const matches of attempts) {
            if (matches.length === 1) return matches[0]!;
        }

        // No precision level identified exactly one. Report from the most precise level that found
        // candidates at all, so the list offered is the smallest useful one.
        for (const matches of attempts) {
            if (matches.length > 1) throw new AmbiguousRefError(trimmed, matches);
        }

        throw new IssueNotFoundError(trimmed);
    }

    children(id: number): Issue[] {
        return this.all().filter((issue) => issue.parent === id);
    }

    /** Next id is derived from the files on disk — see `.motte/issues/0015-*` for why. */
    nextId(): number {
        const ids = this.all().map((issue) => issue.id);
        return ids.length === 0 ? 1 : Math.max(...ids) + 1;
    }

    // ---------------------------------------------------------------- writing

    create(input: NewIssue): Issue {
        const state =
            input.state === undefined
                ? this.config.defaultState
                : resolveState(this.config, input.state).name;

        if (input.parent !== undefined) this.require(input.parent);
        for (const blocker of input.blockedBy ?? []) this.require(blocker);

        const now = timestamp();
        const issue: Issue = {
            id: this.nextId(),
            title: input.title.trim(),
            state,
            ...(input.parent === undefined ? {} : { parent: input.parent }),
            ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
            ...(input.labels === undefined || input.labels.length === 0
                ? {}
                : { labels: input.labels }),
            ...(input.blockedBy === undefined || input.blockedBy.length === 0
                ? {}
                : { blockedBy: input.blockedBy }),
            created: now,
            updated: now,
            description: (input.description ?? "").trim(),
            plan: (input.plan ?? "").trim(),
            notes: [],
            unknownSections: []
        };

        return this.write(issue, issueFilename(issue.id, issue.title));
    }

    /** Create several children under one parent, allocating ids in a single pass. */
    createMany(parent: number | undefined, inputs: NewIssue[]): Issue[] {
        if (parent !== undefined) this.require(parent);

        const created: Issue[] = [];
        for (const input of inputs) {
            created.push(this.create(parent === undefined ? input : { ...input, parent }));
        }
        return created;
    }

    update(id: number, patch: IssuePatch): Issue {
        const existing = this.require(id);
        const next: Issue = { ...existing };

        if (patch.title !== undefined) next.title = patch.title.trim();
        if (patch.description !== undefined) next.description = patch.description.trim();
        if (patch.plan !== undefined) next.plan = patch.plan.trim();
        if (patch.state !== undefined) next.state = resolveState(this.config, patch.state).name;
        if (patch.labels !== undefined) {
            if (patch.labels.length === 0) delete next.labels;
            else next.labels = patch.labels;
        }

        if (patch.assignee !== undefined) {
            if (patch.assignee === null) delete next.assignee;
            else next.assignee = patch.assignee.trim();
        }

        if (patch.blockedBy !== undefined) {
            if (patch.blockedBy.length === 0) {
                delete next.blockedBy;
            } else {
                for (const blocker of patch.blockedBy) this.require(blocker);
                this.assertNoDependencyCycle(id, patch.blockedBy);
                next.blockedBy = patch.blockedBy;
            }
        }

        if (patch.parent !== undefined) {
            if (patch.parent === null) {
                delete next.parent;
            } else {
                this.assertNoCycle(id, patch.parent);
                next.parent = patch.parent;
            }
        }

        next.updated = timestamp();

        // Rename when the title changed so the filename keeps matching, but keep the id prefix.
        // Removing the old file is `write`'s job, so every mutator gets it.
        return this.write(next, issueFilename(next.id, next.title));
    }

    /**
     * Replace an issue wholesale from an externally edited version — the `$EDITOR` path.
     *
     * Unlike `update`, this can change notes and unknown sections, because the editor hands back a
     * whole file. `id` and `created` are taken from the issue on disk rather than the edited copy:
     * they are identity, not content, and an accidental change to either would silently fork the
     * issue. Everything else the editor said wins.
     */
    replace(id: number, edited: Issue): Issue {
        const existing = this.require(id);

        const state = resolveState(this.config, edited.state).name;

        if (edited.parent !== undefined) {
            this.require(edited.parent);
            if (edited.parent !== existing.parent) this.assertNoCycle(id, edited.parent);
        }

        if (edited.blockedBy !== undefined && edited.blockedBy.length > 0) {
            for (const blocker of edited.blockedBy) this.require(blocker);
            this.assertNoDependencyCycle(id, edited.blockedBy);
        }

        const next: Issue = {
            ...edited,
            id: existing.id,
            created: existing.created,
            state,
            updated: timestamp()
        };

        if (next.blockedBy !== undefined && next.blockedBy.length === 0) delete next.blockedBy;
        if (next.labels !== undefined && next.labels.length === 0) delete next.labels;

        // As with `update`, removing the file this issue used to live in is `write`'s job.
        return this.write(next, issueFilename(next.id, next.title));
    }

    setState(id: number, state: string): Issue {
        return this.update(id, { state });
    }

    setParent(id: number, parent: number | null): Issue {
        return this.update(id, { parent });
    }

    assign(id: number, assignee: string | null): Issue {
        return this.update(id, { assignee });
    }

    /**
     * Take an issue: set the assignee and start it, together, refusing if somebody else holds it.
     *
     * The whole point is the refusal. Two agents call `ready` or `next`, both get #0042, and today both set
     * themselves as assignee — the second write wins, the first agent's work is orphaned, and the record
     * shows one name, so nothing ever said it happened.
     *
     * Compare-and-set within one working tree, which is the case that matters: two agents in one repository.
     * Across branches git stays the arbiter, the same bargain the rest of the format makes, and `doctor`
     * reports what conflicts.
     */
    claim(
        id: number,
        author: AuthorOptions | Author = {},
        options: { force?: boolean } = {}
    ): Issue {
        const existing = this.require(id);
        const claimant = this.nameOf(author);

        if (isSettled(this.config, existing)) {
            throw new ClaimedError(id, `nobody — #${padId(id)} is already ${existing.state}`);
        }

        const holder = existing.assignee;
        if (
            options.force !== true &&
            holder !== undefined &&
            holder.toLowerCase() !== claimant.toLowerCase()
        ) {
            throw new ClaimedError(id, holder);
        }

        // The first started state in the project's own order. A project may configure several — this one
        // has Blocked as well as In Progress — and the first is the one that means "being worked on".
        const started = this.config.states.find((state) => state.category === "started");

        // Already started stays as it is. Any started state means the work has begun, so a Blocked issue
        // must not be quietly reinterpreted as In Progress by the act of claiming it.
        const alreadyStarted = stateCategory(this.config, existing.state) === "started";

        // The stored spelling wins when the same person claims again, so retrying costs no write and records
        // no transition just because they typed their name differently. Anyone else — which only `force`
        // reaches — takes it over.
        const sameHolder = holder !== undefined && holder.toLowerCase() === claimant.toLowerCase();

        return this.update(id, {
            ...(sameHolder ? {} : { assignee: claimant }),
            ...(started === undefined || alreadyStarted ? {} : { state: started.name })
        });
    }

    /**
     * Put an issue back: clear the assignee and return it to the default state.
     *
     * The other half of claiming. Without it, an agent that gives up either leaves the issue looking like
     * work in progress or edits two fields and hopes the next one notices.
     */
    release(
        id: number,
        author: AuthorOptions | Author = {},
        options: { force?: boolean } = {}
    ): Issue {
        const existing = this.require(id);
        const holder = existing.assignee;

        if (
            options.force !== true &&
            holder !== undefined &&
            holder.toLowerCase() !== this.nameOf(author).toLowerCase()
        ) {
            throw new ClaimedError(id, holder);
        }

        return this.update(id, {
            assignee: null,
            ...(isSettled(this.config, existing) ? {} : { state: this.config.defaultState })
        });
    }

    /** Add a blocker. Idempotent — blocking twice on the same issue is not an error. */
    block(id: number, blocker: number): Issue {
        const existing = this.require(id);
        const current = existing.blockedBy ?? [];
        if (current.includes(blocker)) return existing;

        return this.update(id, { blockedBy: [...current, blocker] });
    }

    /** Remove a blocker. Idempotent — unblocking something that was not blocking is not an error. */
    unblock(id: number, blocker: number): Issue {
        const existing = this.require(id);
        const current = existing.blockedBy ?? [];
        if (!current.includes(blocker)) return existing;

        return this.update(id, { blockedBy: current.filter((candidate) => candidate !== blocker) });
    }

    /** Issues that name `id` as a blocker — the derived inverse of `blockedBy`. */
    blocks(id: number): Issue[] {
        return blocks(this.all(), id);
    }

    /** Not settled, and nothing standing in the way. */
    ready(): Issue[] {
        return ready(this.config, this.all());
    }

    /** Not settled, and waiting on at least one unsettled blocker. */
    blocked(): Issue[] {
        return blocked(this.config, this.all());
    }

    addNote(id: number, body: string, author: AuthorOptions | Author = {}): Issue {
        const existing = this.require(id);
        const note = this.noteFrom(body, author);
        const next: Issue = {
            ...existing,
            notes: [...existing.notes, note],
            updated: note.at
        };

        return this.write(next, issueFilename(next.id, next.title));
    }

    /**
     * Repair a file's name and formatting without changing what it says.
     *
     * The two mechanical findings `doctor` reports — a filename that disagrees with the frontmatter, and a
     * file that would be rewritten if written back — are one operation: format the issue and put it at the
     * name its id and title imply.
     *
     * `updated` is deliberately untouched. Neither repair changes what the issue says, and bumping the
     * timestamp would make a formatting fix look like an edit in every report that reads it — including the
     * stale-work check, which would then think somebody had just been working on it.
     */
    normalise(
        filePath: string,
        options: { dryRun?: boolean } = {}
    ): { path: string; renamed: boolean; rewritten: boolean } {
        const raw = readFileSync(filePath, "utf8");
        const issue = parseIssueFile(raw, filePath);

        const target = join(this.config.issuesPath, issueFilename(issue.id, issue.title));
        const formatted = formatIssueFile(issue);

        const renamed = target !== filePath;
        const rewritten = formatted !== raw;

        // Reading to decide is not the same as writing to find out: a dry run answers exactly what would
        // happen, from the same comparison the real run makes, and the caller reports it.
        if (options.dryRun === true || (!renamed && !rewritten)) {
            return { path: target, renamed, rewritten };
        }

        const temp = `${target}.${process.pid}.tmp`;
        writeFileSync(temp, formatted, "utf8");
        renameSync(temp, target);

        this.cache.set(target, {
            mtimeMs: statSync(target).mtimeMs,
            issue: { ...issue, filePath: target }
        });

        if (renamed) {
            unlinkSync(filePath);
            this.cache.delete(filePath);
        }

        return { path: target, renamed, rewritten };
    }

    /**
     * Give the issue in one specific file a new id, rewriting and renaming the file.
     *
     * Addressed by path rather than by id, because the only reason to call this is that two files claim
     * the same id and `require(id)` therefore cannot tell them apart. That is also why it does not go
     * through `write`: that helper finds the previous version by id, which under a duplicate would find
     * the wrong file and delete it.
     *
     * A note records where the number came from. The event log cannot be reassigned — both files recorded
     * their history under the one id, so those entries are already inseparable — and this way the file
     * itself carries the explanation for anyone who later finds the old number in a commit message.
     */
    renumberFile(filePath: string, newId: number, author: AuthorOptions | Author = {}): Issue {
        const existing = parseIssueFile(readFileSync(filePath, "utf8"), filePath);

        if (this.all().some((issue) => issue.id === newId)) {
            throw new Error(`#${newId} is already in use`);
        }

        const note = this.noteFrom(
            `Renumbered from #${padId(existing.id)}, which two files had claimed.`,
            author
        );

        const next: Issue = {
            ...existing,
            id: newId,
            notes: [...existing.notes, note],
            updated: note.at
        };

        const target = join(this.config.issuesPath, issueFilename(newId, next.title));
        const temp = `${target}.${process.pid}.tmp`;

        writeFileSync(temp, formatIssueFile(next), "utf8");
        renameSync(temp, target);

        const written: Issue = { ...next, filePath: target };
        this.cache.set(target, { mtimeMs: statSync(target).mtimeMs, issue: written });

        if (filePath !== target) {
            unlinkSync(filePath);
            this.cache.delete(filePath);
        }

        return written;
    }

    /** What `merge` would do, without doing it. Throws the same refusals. */
    planMerge(fromId: number, intoId: number): MergePlan {
        return planMerge(this.all(), fromId, intoId);
    }

    /**
     * Fold one issue into another: the survivor gets everything, the source becomes a tombstone.
     *
     * The order is deliberate. The survivor is written first, then the relations that pointed at the source
     * are moved, and only then is the source's file removed. An interruption anywhere in that sequence
     * leaves the work duplicated rather than lost, which is the failure that can be fixed by hand.
     *
     * State and assignee are left alone. Which of two duplicates is being worked on, and by whom, is a
     * judgement the caller can already express with `claim` and `move`; a merge silently starting an issue
     * because its duplicate had been started would be a decision made in the wrong place.
     */
    merge(fromId: number, intoId: number, author: AuthorOptions | Author = {}): Issue {
        const plan = this.planMerge(fromId, intoId);
        const { from, into } = plan;

        const marker = this.noteFrom(mergedBody(from), author);

        // Merged by date rather than appended in a block, so the survivor's note stream still reads in the
        // order things were written. Each note keeps its own author and timestamp, so nothing about where
        // it came from is lost — and the marker note says how many arrived.
        const notes = [...into.notes, ...from.notes].sort((a, b) => a.at.localeCompare(b.at));

        const survivor: Issue = {
            ...into,
            ...(plan.parent === undefined ? {} : { parent: plan.parent }),
            ...(plan.labels.length > 0 ? { labels: [...(into.labels ?? []), ...plan.labels] } : {}),
            notes: [...notes, marker],
            updated: marker.at
        };

        if (plan.blockedByAfter.length > 0) survivor.blockedBy = plan.blockedByAfter;
        else delete survivor.blockedBy;

        const written = this.write(survivor, issueFilename(survivor.id, survivor.title));

        for (const child of plan.children) this.setParent(child.id, intoId);

        for (const dependent of plan.dependents) {
            const blockedBy = (dependent.blockedBy ?? []).filter((blocker) => blocker !== fromId);
            this.update(dependent.id, {
                blockedBy: blockedBy.includes(intoId) ? blockedBy : [...blockedBy, intoId]
            });
        }

        // Last, and with the tombstone written before the file goes: an id that leads nowhere is worse than
        // one that leads to a file which is still there.
        this.tombstone(from, intoId, author);
        this.remove(fromId);

        // Re-read: the child and dependent writes above may have touched rows this one does not hold.
        return this.all().find((issue) => issue.id === written.id) ?? written;
    }

    /** The `merged` event, so the source's number still leads somewhere. */
    private tombstone(from: Issue, into: number, author: AuthorOptions | Author): void {
        if (!this.config.events.enabled) return;

        // The store's own author wins over a lookup when the caller said nothing, matching `record`: the
        // MCP server sets it once at construction rather than passing it to every call.
        const resolved =
            Object.keys(author).length === 0
                ? (this.author ?? resolveAuthor({ cwd: this.config.root }))
                : this.authorOf(author);

        try {
            appendEvents(
                eventsDir(this.config.root),
                [
                    {
                        at: timestamp(),
                        by: resolved.name,
                        as: resolved.type,
                        id: from.id,
                        type: "merged",
                        into,
                        title: from.title
                    }
                ],
                resolved
            );
        } catch {
            // Best effort, as everywhere else the log is written: the merge itself has succeeded.
        }
    }

    /** Remove an issue's file. Children are left in place and reported as orphans by `doctor`. */
    remove(id: number): void {
        const issue = this.require(id);
        if (issue.filePath !== undefined) {
            unlinkSync(issue.filePath);
            this.cache.delete(issue.filePath);
        }
    }

    // --------------------------------------------------------------- internals

    /**
     * Who to record, however the caller identified themselves.
     *
     * Shared because it was not: `renumberFile` arrived with its own copy of the same lines, which fallow
     * caught as a clone group, and `merge`'s tombstone would have made a fourth. An already-resolved
     * `Author` is passed straight through — that is how the MCP server attributes work to the agent rather
     * than to the git user — and anything else goes through `resolveAuthor`.
     */
    private authorOf(author: AuthorOptions | Author): Author {
        return "type" in author && "name" in author && typeof author.name === "string"
            ? (author as Author)
            : resolveAuthor({ ...(author as AuthorOptions), cwd: this.config.root });
    }

    /** The name alone, for the fields that store a name rather than an author. */
    private nameOf(author: AuthorOptions | Author): string {
        return this.authorOf(author).name;
    }

    private noteFrom(body: string, author: AuthorOptions | Author): Note {
        return { at: timestamp(), author: this.authorOf(author), body: body.trim() };
    }

    private assertNoDependencyCycle(id: number, blockedBy: number[]): void {
        const issues = this.all();
        const hypothetical = issues.map((issue) =>
            issue.id === id ? { ...issue, blockedBy } : issue
        );

        const cycle = findDependencyCycle(hypothetical, id);
        if (cycle !== undefined) throw new DependencyCycleError(cycle);
    }

    private assertNoCycle(id: number, parent: number): void {
        if (id === parent) throw new CycleError([id, id]);
        this.require(parent);

        const path = [id];
        const byId = new Map(this.all().map((issue) => [issue.id, issue]));

        let cursor: number | undefined = parent;
        while (cursor !== undefined) {
            path.push(cursor);
            if (cursor === id) throw new CycleError(path);
            cursor = byId.get(cursor)?.parent;
        }
    }

    /**
     * Write atomically: full content to a temp file in the same directory, then rename over.
     *
     * Every mutation funnels through here, which is why the event log is appended here rather than
     * from each public method. A new mutator added later records its transitions without anyone having
     * to remember to wire it up.
     */
    private write(issue: Issue, filename: string): Issue {
        // Captured before the write, and looked up by id rather than by path so a rename does not
        // make the previous version invisible.
        const before = this.all().find((candidate) => candidate.id === issue.id);

        mkdirSync(this.config.issuesPath, { recursive: true });

        const filePath = join(this.config.issuesPath, filename);
        const temp = `${filePath}.${process.pid}.tmp`;

        writeFileSync(temp, formatIssueFile(issue), "utf8");
        renameSync(temp, filePath);

        const written: Issue = { ...issue, filePath };
        this.cache.set(filePath, { mtimeMs: statSync(filePath).mtimeMs, issue: written });

        /**
         * Remove the file this issue used to live in.
         *
         * Centralised here rather than in each mutator, because it was not: `addNote` wrote to the
         * title-derived filename without unlinking the old path, so adding a note to an issue whose
         * filename did not already match its title left two files with the same id. `motte doctor`
         * caught it in CI as a duplicate-id error. Doing it in the one place every write passes through
         * means a mutator added later cannot reintroduce it.
         */
        if (before?.filePath !== undefined && before.filePath !== filePath) {
            try {
                unlinkSync(before.filePath);
            } catch {
                // The new file is written; a stale one is reported by `motte doctor` rather than
                // failing a write that has already succeeded.
            }
            this.cache.delete(before.filePath);
        }

        this.record(before, written);

        return written;
    }

    /**
     * Append the transitions this write represents.
     *
     * Best effort by design: an unwritable events directory must not fail the write that already
     * succeeded. The issue files are the source of truth, and a missing event is a gap in reporting
     * rather than lost work.
     */
    private record(before: Issue | undefined, after: Issue): void {
        if (!this.config.events.enabled) return;

        const author = this.author ?? resolveAuthor({ cwd: this.config.root });
        const events = transitionsBetween(before, after, author, timestamp());
        if (events.length === 0) return;

        try {
            appendEvents(eventsDir(this.config.root), events, author);
        } catch {
            // Deliberately silent — see above. `motte doctor` reports an unreadable log separately.
        }
    }

    /** Every recorded event, merged across shards and sorted by time. */
    events(options: { since?: string } = {}): ReadResult {
        return readEvents(eventsDir(this.config.root), options);
    }
}
