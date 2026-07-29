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
import { resolveState, type Config } from "./config.js";
import { formatIssueFile, IssueParseError, parseIssueFile } from "./serialize.js";
import { issueFilename } from "./slug.js";
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

export class CycleError extends Error {
    constructor(readonly path: number[]) {
        super(`that would create a cycle: ${path.map((id) => `#${id}`).join(" → ")}`);
        this.name = "CycleError";
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

    constructor(readonly config: Config) {}

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

    get(id: number): Issue | undefined {
        return this.all().find((issue) => issue.id === id);
    }

    require(id: number): Issue {
        const issue = this.get(id);
        if (!issue) throw new IssueNotFoundError(id);
        return issue;
    }

    /**
     * Resolve a user-supplied reference: a number is an id, anything else is a case-insensitive
     * substring match on the title. Exact title matches win over substring matches, which is what
     * makes short titles addressable even when they appear inside longer ones.
     */
    resolve(ref: string | number): Issue {
        if (typeof ref === "number") return this.require(ref);

        const trimmed = ref.trim();
        if (/^#?\d+$/.test(trimmed)) {
            return this.require(Number.parseInt(trimmed.replace(/^#/, ""), 10));
        }

        const needle = trimmed.toLowerCase();
        const issues = this.all();

        const exact = issues.filter((issue) => issue.title.toLowerCase() === needle);
        if (exact.length === 1) return exact[0]!;

        const matches = issues.filter((issue) => issue.title.toLowerCase().includes(needle));
        if (matches.length === 1) return matches[0]!;
        if (matches.length > 1) throw new AmbiguousRefError(trimmed, matches);

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
        const filename = issueFilename(next.id, next.title);
        const previousPath = existing.filePath;
        const written = this.write(next, filename);

        if (previousPath !== undefined && previousPath !== written.filePath) {
            try {
                unlinkSync(previousPath);
            } catch {
                // The rename target was written; a stale source is reported by `motte doctor`
                // rather than failing the update.
            }
            this.cache.delete(previousPath);
        }

        return written;
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

    addNote(id: number, body: string, author: AuthorOptions | Author = {}): Issue {
        const existing = this.require(id);
        const resolved: Author =
            "type" in author && "name" in author && typeof author.name === "string"
                ? (author as Author)
                : resolveAuthor({ ...(author as AuthorOptions), cwd: this.config.root });

        const note: Note = { at: timestamp(), author: resolved, body: body.trim() };
        const next: Issue = {
            ...existing,
            notes: [...existing.notes, note],
            updated: note.at
        };

        return this.write(next, issueFilename(next.id, next.title));
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

    /** Write atomically: full content to a temp file in the same directory, then rename over. */
    private write(issue: Issue, filename: string): Issue {
        mkdirSync(this.config.issuesPath, { recursive: true });

        const filePath = join(this.config.issuesPath, filename);
        const temp = `${filePath}.${process.pid}.tmp`;

        writeFileSync(temp, formatIssueFile(issue), "utf8");
        renameSync(temp, filePath);

        const written: Issue = { ...issue, filePath };
        this.cache.set(filePath, { mtimeMs: statSync(filePath).mtimeMs, issue: written });
        return written;
    }
}
