import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EventSchema, type Event } from "./schema/event.js";
import type { Author, Issue } from "./schema/issue.js";
import { slugify } from "./slug.js";

/**
 * Shard naming: `<YYYY-MM>.<actor>.ndjson`.
 *
 * The month bounds file size and makes pruning a file operation. The actor half is the important one:
 * two agents on two branches never write the same file, so append/append merge conflicts become
 * structurally impossible rather than merely rare. Readers merge-sort across shards.
 */
export function shardName(at: string, author: Author): string {
    const month = at.slice(0, 7);
    return `${month}.${slugify(author.name)}.ndjson`;
}

export function eventsDir(root: string): string {
    return join(root, ".motte", "events");
}

/** A line that could not be read as an event, and why. Surfaced by `motte doctor`. */
export interface BrokenEventLine {
    file: string;
    line: number;
    message: string;
}

export interface ReadResult {
    events: Event[];
    broken: BrokenEventLine[];
}

/**
 * Append events to the appropriate shard.
 *
 * Grouped by shard so a batch — a `breakdown` creating ten children, say — is one append per file
 * rather than one per event.
 */
export function appendEvents(dir: string, events: Event[], author: Author): void {
    if (events.length === 0) return;

    const byShard = new Map<string, string[]>();
    for (const event of events) {
        const name = shardName(event.at, author);
        const lines = byShard.get(name) ?? [];
        lines.push(JSON.stringify(event));
        byShard.set(name, lines);
    }

    mkdirSync(dir, { recursive: true });
    for (const [name, lines] of byShard) {
        appendFileSync(join(dir, name), `${lines.join("\n")}\n`, "utf8");
    }
}

/**
 * Read every shard, merged into one timeline.
 *
 * A malformed line is collected rather than thrown. The log is a convenience over the issue files,
 * which remain the source of truth — a corrupt shard should degrade reporting, never block work.
 */
export function readEvents(dir: string, options: { since?: string } = {}): ReadResult {
    if (!existsSync(dir)) return { events: [], broken: [] };

    const events: Event[] = [];
    const broken: BrokenEventLine[] = [];

    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith(".ndjson")) continue;

        // Shards are named by month, so anything wholly before the cutoff can be skipped unread.
        if (options.since !== undefined && name.slice(0, 7) < options.since.slice(0, 7)) continue;

        let contents: string;
        try {
            contents = readFileSync(join(dir, name), "utf8");
        } catch (error) {
            broken.push({
                file: name,
                line: 0,
                message: error instanceof Error ? error.message : String(error)
            });
            continue;
        }

        contents.split("\n").forEach((line, index) => {
            if (line.trim().length === 0) return;

            let raw: unknown;
            try {
                raw = JSON.parse(line);
            } catch {
                broken.push({ file: name, line: index + 1, message: "not valid JSON" });
                return;
            }

            const parsed = EventSchema.safeParse(raw);
            if (!parsed.success) {
                broken.push({
                    file: name,
                    line: index + 1,
                    // An unrecognised `type` is the likely cause: a newer motte wrote something this
                    // one does not know about, which is worth reporting but not worth failing over.
                    message: parsed.error.issues[0]?.message ?? "does not match the event schema"
                });
                return;
            }

            if (options.since !== undefined && parsed.data.at < options.since) return;
            events.push(parsed.data);
        });
    }

    /**
     * Sorted by time alone, deliberately, and relying on `sort` being stable.
     *
     * Timestamps are second-precision, so a burst of writes shares one `at`. Adding a tiebreaker like
     * issue id would reorder those into id groups — a timeline would then show "created #1, #1 moved
     * to Done, created #2" when what actually happened was "created #1, created #2, #1 moved". Within
     * a shard, file order is write order because the file is append-only, so a stable sort on `at`
     * preserves the real sequence. Ties across shards fall back to shard name: arbitrary between two
     * actors who acted in the same second, but deterministic.
     */
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    return { events, broken };
}

/**
 * The transitions between two versions of an issue.
 *
 * Pure, so the diff rules are testable without a filesystem. `before` is undefined for a newly created
 * issue. Anything that did not actually change produces nothing — moving an issue to the state it is
 * already in should not litter the log.
 */
export function transitionsBetween(
    before: Issue | undefined,
    after: Issue,
    author: Author,
    at: string
): Event[] {
    const base = { at, id: after.id, by: author.name, as: author.type };

    if (before === undefined) {
        return [{ ...base, type: "created", title: after.title, state: after.state }];
    }

    const events: Event[] = [];

    if (before.state !== after.state) {
        events.push({ ...base, type: "state", from: before.state, to: after.state });
    }

    if (before.title !== after.title) {
        events.push({ ...base, type: "title", from: before.title, to: after.title });
    }

    if ((before.assignee ?? null) !== (after.assignee ?? null)) {
        events.push({
            ...base,
            type: "assigned",
            from: before.assignee ?? null,
            to: after.assignee ?? null
        });
    }

    if ((before.parent ?? null) !== (after.parent ?? null)) {
        events.push({
            ...base,
            type: "parent",
            from: before.parent ?? null,
            to: after.parent ?? null
        });
    }

    const previousBlockers = new Set(before.blockedBy ?? []);
    const currentBlockers = new Set(after.blockedBy ?? []);

    for (const blocker of currentBlockers) {
        if (!previousBlockers.has(blocker)) {
            events.push({ ...base, type: "blocked", blocker });
        }
    }
    for (const blocker of previousBlockers) {
        if (!currentBlockers.has(blocker)) {
            events.push({ ...base, type: "unblocked", blocker });
        }
    }

    return events;
}

/** Events for one issue, oldest first. */
export function eventsFor(events: Event[], id: number): Event[] {
    return events.filter((event) => event.id === id);
}

/**
 * How long an issue has spent in each state, from its transitions.
 *
 * The open-ended final span is measured to `now`, which is what makes "this has been In Progress for
 * three days" answerable — the question that could not be asked before the log existed.
 */
export function timeInState(
    events: Event[],
    id: number,
    now: Date = new Date()
): Map<string, number> {
    const mine = eventsFor(events, id);
    const totals = new Map<string, number>();

    let currentState: string | undefined;
    let since: number | undefined;

    const add = (state: string, from: number, to: number) => {
        totals.set(state, (totals.get(state) ?? 0) + Math.max(0, to - from));
    };

    for (const event of mine) {
        const stamp = Date.parse(event.at);
        if (Number.isNaN(stamp)) continue;

        if (event.type === "created") {
            currentState = event.state;
            since = stamp;
        } else if (event.type === "state") {
            if (currentState !== undefined && since !== undefined) add(currentState, since, stamp);
            currentState = event.to;
            since = stamp;
        }
    }

    if (currentState !== undefined && since !== undefined) {
        add(currentState, since, now.getTime());
    }

    return totals;
}
