import { describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    appendEvents,
    eventsFor,
    readEvents,
    shardName,
    timeInState,
    transitionsBetween
} from "./events.js";
import type { Event } from "./schema/event.js";
import type { Author, Issue } from "./schema/issue.js";

const USER: Author = { name: "Christopher Vachon", type: "user" };
const AGENT: Author = { name: "claude-code", type: "agent" };

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        created: "2026-07-30T10:00:00Z",
        updated: "2026-07-30T10:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

describe("shardName", () => {
    it("shards by month and actor", () => {
        expect(shardName("2026-07-30T12:00:00Z", USER)).toBe("2026-07.christopher-vachon.ndjson");
        expect(shardName("2026-07-30T12:00:00Z", AGENT)).toBe("2026-07.claude-code.ndjson");
    });

    /**
     * The point of the actor half: two writers never touch the same file, so an append/append merge
     * conflict is structurally impossible rather than merely unlikely.
     */
    it("gives two actors in the same month different files", () => {
        expect(shardName("2026-07-01T00:00:00Z", USER)).not.toBe(
            shardName("2026-07-01T00:00:00Z", AGENT)
        );
    });

    it("gives one actor a new file each month", () => {
        expect(shardName("2026-07-31T23:59:59Z", USER)).not.toBe(
            shardName("2026-08-01T00:00:00Z", USER)
        );
    });
});

describe("transitionsBetween", () => {
    const at = "2026-07-30T12:00:00Z";

    it("records a creation", () => {
        const events = transitionsBetween(undefined, issue(), USER, at);

        expect(events).toEqual([
            {
                at,
                id: 1,
                by: "Christopher Vachon",
                as: "user",
                type: "created",
                title: "An issue",
                state: "Todo"
            }
        ]);
    });

    it("records nothing when nothing changed", () => {
        // Moving an issue to the state it is already in should not litter the log.
        expect(transitionsBetween(issue(), issue(), USER, at)).toEqual([]);
    });

    it("records a state change with both ends", () => {
        const events = transitionsBetween(issue(), issue({ state: "Done" }), USER, at);

        expect(events).toEqual([
            {
                at,
                id: 1,
                by: "Christopher Vachon",
                as: "user",
                type: "state",
                from: "Todo",
                to: "Done"
            }
        ]);
    });

    it("records a title change", () => {
        const events = transitionsBetween(issue(), issue({ title: "Renamed" }), USER, at);
        expect(events[0]).toMatchObject({ type: "title", from: "An issue", to: "Renamed" });
    });

    it("records assignment and unassignment, using null for absent", () => {
        const assigned = transitionsBetween(issue(), issue({ assignee: "atlas" }), USER, at);
        expect(assigned[0]).toMatchObject({ type: "assigned", from: null, to: "atlas" });

        const cleared = transitionsBetween(issue({ assignee: "atlas" }), issue(), USER, at);
        expect(cleared[0]).toMatchObject({ type: "assigned", from: "atlas", to: null });
    });

    it("records re-parenting", () => {
        const events = transitionsBetween(issue(), issue({ parent: 7 }), USER, at);
        expect(events[0]).toMatchObject({ type: "parent", from: null, to: 7 });
    });

    it("records each blocker added and removed separately", () => {
        const events = transitionsBetween(
            issue({ blockedBy: [2, 3] }),
            issue({ blockedBy: [3, 4] }),
            USER,
            at
        );

        expect(events).toHaveLength(2);
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "blocked", blocker: 4 }),
                expect.objectContaining({ type: "unblocked", blocker: 2 })
            ])
        );
    });

    it("records several transitions from one write", () => {
        const events = transitionsBetween(
            issue(),
            issue({ state: "Done", assignee: "atlas", title: "Renamed" }),
            AGENT,
            at
        );

        expect(events.map((event) => event.type).sort()).toEqual(["assigned", "state", "title"]);
        expect(events.every((event) => event.as === "agent")).toBe(true);
    });

    it("does not record description or plan edits", () => {
        // Their history is already in `git log -p`; a second copy could disagree with the first.
        const events = transitionsBetween(
            issue(),
            issue({ description: "New text.", plan: "1. Do it" }),
            USER,
            at
        );

        expect(events).toEqual([]);
    });

    it("does not record notes", () => {
        // Notes already carry their own timestamp and author in the issue file.
        const withNote = issue({
            notes: [{ at, author: USER, body: "A note." }]
        });

        expect(transitionsBetween(issue(), withNote, USER, at)).toEqual([]);
    });
});

describe("appendEvents and readEvents", () => {
    function scratch(): string {
        return mkdtempSync(join(tmpdir(), "motte-events-"));
    }

    const event = (overrides: Partial<Event> = {}): Event =>
        ({
            at: "2026-07-30T12:00:00Z",
            id: 1,
            by: USER.name,
            as: "user",
            type: "state",
            from: "Todo",
            to: "Done",
            ...overrides
        }) as Event;

    it("round-trips", () => {
        const dir = scratch();
        appendEvents(dir, [event()], USER);

        const { events, broken } = readEvents(dir);
        expect(broken).toEqual([]);
        expect(events).toEqual([event()]);
    });

    it("writes nothing for an empty batch", () => {
        const dir = scratch();
        appendEvents(dir, [], USER);

        expect(readdirSync(dir)).toEqual([]);
    });

    it("appends rather than replacing", () => {
        const dir = scratch();
        appendEvents(dir, [event({ id: 1 })], USER);
        appendEvents(dir, [event({ id: 2 })], USER);

        expect(readEvents(dir).events.map((e) => e.id)).toEqual([1, 2]);
    });

    it("writes one append per shard for a batch", () => {
        const dir = scratch();
        appendEvents(dir, [event({ id: 1 }), event({ id: 2 }), event({ id: 3 })], USER);

        const files = readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(readFileSync(join(dir, files[0]!), "utf8").trim().split("\n")).toHaveLength(3);
    });

    it("merges shards from different actors into one timeline", () => {
        const dir = scratch();
        appendEvents(dir, [event({ at: "2026-07-30T12:00:02Z", id: 2 })], USER);
        appendEvents(
            dir,
            [event({ at: "2026-07-30T12:00:01Z", id: 1, by: AGENT.name, as: "agent" })],
            AGENT
        );

        const { events } = readEvents(dir);

        expect(readdirSync(dir)).toHaveLength(2);
        // Sorted by time, not by file.
        expect(events.map((e) => e.id)).toEqual([1, 2]);
    });

    it("returns nothing when the directory does not exist", () => {
        expect(readEvents(join(tmpdir(), "motte-absent-events"))).toEqual({
            events: [],
            broken: []
        });
    });

    it("ignores files that are not shards", () => {
        const dir = scratch();
        appendEvents(dir, [event()], USER);
        appendFileSync(join(dir, "notes.txt"), "ignore me\n");

        expect(readEvents(dir).events).toHaveLength(1);
    });

    it("collects a malformed line rather than throwing", () => {
        const dir = scratch();
        appendEvents(dir, [event()], USER);
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, shardName(event().at, USER)), "not json\n");

        const { events, broken } = readEvents(dir);

        // The log is a convenience over the issue files; a corrupt shard degrades reporting only.
        expect(events).toHaveLength(1);
        expect(broken).toHaveLength(1);
        expect(broken[0]).toMatchObject({ line: 2, message: "not valid JSON" });
    });

    it("collects an event whose type it does not recognise", () => {
        const dir = scratch();
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, "2026-07.someone.ndjson"),
            `${JSON.stringify({ at: "2026-07-30T12:00:00Z", id: 1, by: "x", as: "user", type: "from-the-future" })}\n`
        );

        const { events, broken } = readEvents(dir);

        // A newer motte writing an unknown type should be reported, not fatal.
        expect(events).toEqual([]);
        expect(broken).toHaveLength(1);
    });

    it("filters by since, and skips whole shards that predate it", () => {
        const dir = scratch();
        appendEvents(dir, [event({ at: "2026-05-01T00:00:00Z" })], USER);
        appendEvents(dir, [event({ at: "2026-07-30T12:00:00Z" })], USER);

        const { events } = readEvents(dir, { since: "2026-07-01T00:00:00Z" });

        expect(events).toHaveLength(1);
        expect(events[0]!.at).toBe("2026-07-30T12:00:00Z");
    });
});

describe("eventsFor", () => {
    it("selects one issue's events in order", () => {
        const events = [
            { at: "1", id: 1 },
            { at: "2", id: 2 },
            { at: "3", id: 1 }
        ] as unknown as Event[];

        expect(eventsFor(events, 1).map((e) => e.at)).toEqual(["1", "3"]);
    });
});

/**
 * The question that could not be asked before the log existed: how long has this been sitting in
 * progress. It is why #0011 and #0015 went unnoticed after their work had moved elsewhere.
 */
describe("timeInState", () => {
    const hours = (n: number) => n * 3600_000;

    it("measures each span between state changes", () => {
        const events = [
            {
                at: "2026-07-30T00:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "created",
                title: "t",
                state: "Todo"
            },
            {
                at: "2026-07-30T02:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "state",
                from: "Todo",
                to: "In Progress"
            },
            {
                at: "2026-07-30T05:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "state",
                from: "In Progress",
                to: "Done"
            }
        ] as Event[];

        const totals = timeInState(events, 1, new Date("2026-07-30T06:00:00Z"));

        expect(totals.get("Todo")).toBe(hours(2));
        expect(totals.get("In Progress")).toBe(hours(3));
        // The final state is open-ended, measured to now.
        expect(totals.get("Done")).toBe(hours(1));
    });

    it("measures an unfinished issue up to now", () => {
        const events = [
            {
                at: "2026-07-30T00:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "created",
                title: "t",
                state: "Todo"
            }
        ] as Event[];

        expect(timeInState(events, 1, new Date("2026-07-30T04:00:00Z")).get("Todo")).toBe(hours(4));
    });

    it("accumulates a state entered more than once", () => {
        const events = [
            {
                at: "2026-07-30T00:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "created",
                title: "t",
                state: "Todo"
            },
            {
                at: "2026-07-30T01:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "state",
                from: "Todo",
                to: "Done"
            },
            {
                at: "2026-07-30T02:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "state",
                from: "Done",
                to: "Todo"
            },
            {
                at: "2026-07-30T03:00:00Z",
                id: 1,
                by: "x",
                as: "user",
                type: "state",
                from: "Todo",
                to: "Done"
            }
        ] as Event[];

        const totals = timeInState(events, 1, new Date("2026-07-30T03:00:00Z"));

        // Reopened work counts both stints.
        expect(totals.get("Todo")).toBe(hours(2));
    });

    it("ignores other issues", () => {
        const events = [
            {
                at: "2026-07-30T00:00:00Z",
                id: 2,
                by: "x",
                as: "user",
                type: "created",
                title: "t",
                state: "Todo"
            }
        ] as Event[];

        expect(timeInState(events, 1, new Date("2026-07-30T04:00:00Z")).size).toBe(0);
    });

    it("returns nothing for an issue with no events", () => {
        expect(timeInState([], 1).size).toBe(0);
    });
});
