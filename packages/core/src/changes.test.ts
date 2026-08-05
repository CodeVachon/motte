import { describe, expect, it } from "vitest";
import { snapshotChanges, type Change, type Snapshot } from "./changes.js";
import { DEFAULT_STATES } from "./schema/config.js";
import type { Config } from "./schema/config.js";
import type { Event } from "./schema/event.js";
import type { Issue, Note } from "./schema/issue.js";

/**
 * Working out what changed between two readings.
 *
 * Built from hand-written before/after pairs rather than by driving a store, because the interesting cases
 * are the ones a store makes awkward to produce: a file edited by hand with no event recorded, an event log
 * that is switched off, and an issue becoming ready because a different issue was closed.
 */

const config: Config = {
    name: "Test",
    issuesDir: ".motte/issues",
    states: [...DEFAULT_STATES, { name: "Cancelled", category: "cancelled" }],
    defaultState: "Todo",
    root: "/nowhere",
    configPath: "/nowhere/.motte.config.json",
    issuesPath: "/nowhere/.motte/issues",
    events: { enabled: true }
};

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        created: "2026-08-01T09:00:00Z",
        updated: "2026-08-01T09:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

function note(overrides: Partial<Note> = {}): Note {
    return {
        at: "2026-08-02T10:00:00Z",
        author: { name: "atlas", type: "agent" },
        body: "Looked at it.",
        ...overrides
    };
}

function snapshot(issues: Issue[], events: Event[] = []): Snapshot {
    return { issues, events };
}

/** The transitions, as their event types, which is the summary most assertions want. */
function kinds(changes: Change[]): string[] {
    return changes.map((change) => (change.kind === "event" ? change.event.type : change.kind));
}

describe("nothing happening", () => {
    it("reports no changes between two identical readings", () => {
        const one = snapshot([issue()]);

        expect(snapshotChanges(config, one, one)).toEqual([]);
    });

    it("ignores an issue whose file was rewritten without changing anything that shows", () => {
        // `updated` moves on any write, and on its own it is not a transition.
        const before = snapshot([issue({ updated: "2026-08-01T09:00:00Z" })]);
        const after = snapshot([issue({ updated: "2026-08-03T09:00:00Z" })]);

        expect(snapshotChanges(config, before, after)).toEqual([]);
    });
});

describe("the transitions a comparison can see", () => {
    it("notices a new issue", () => {
        const changes = snapshotChanges(config, snapshot([]), snapshot([issue({ id: 4 })]));

        expect(kinds(changes)).toEqual(["created"]);
        expect(changes[0]).toMatchObject({ title: "An issue" });
    });

    it("notices a state change, and both ends of it", () => {
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ state: "In Progress" })])
        );

        expect(changes).toHaveLength(1);
        expect(changes[0]!.kind === "event" && changes[0]!.event).toMatchObject({
            type: "state",
            from: "Todo",
            to: "In Progress"
        });
    });

    it("notices assignment, re-parenting, retitling, blocking and unblocking", () => {
        const from = snapshot([issue({ blockedBy: [2] }), issue({ id: 2 })]);
        const to = snapshot([
            issue({
                title: "Renamed",
                assignee: "atlas",
                parent: 2,
                blockedBy: [3]
            }),
            issue({ id: 2 }),
            issue({ id: 3 })
        ]);

        expect(kinds(snapshotChanges(config, from, to)).sort()).toEqual(
            ["assigned", "blocked", "created", "parent", "title", "unblocked"].sort()
        );
    });

    it("notices a note, with the author the note itself carries", () => {
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ notes: [note()] })])
        );

        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
            kind: "note",
            id: 1,
            note: { author: { name: "atlas", type: "agent" } }
        });
    });

    it("does not report a note it has already seen", () => {
        const one = note();
        const two = note({ at: "2026-08-02T11:00:00Z", body: "And again." });

        const changes = snapshotChanges(
            config,
            snapshot([issue({ notes: [one] })]),
            snapshot([issue({ notes: [one, two] })])
        );

        expect(changes).toHaveLength(1);
        expect(changes[0]!.kind === "note" && changes[0]!.note.body).toBe("And again.");
    });

    it("notices an issue that is gone", () => {
        const changes = snapshotChanges(config, snapshot([issue({ id: 9 })]), snapshot([]));

        expect(changes).toEqual([{ kind: "removed", id: 9, title: "An issue" }]);
    });
});

/**
 * The transition the event log cannot supply, and the reason a dashboard is worth having when several
 * agents are working: one of them finishing a blocker is what lets another start.
 */
describe("becoming ready", () => {
    const blocked = () => issue({ id: 1, blockedBy: [2] });

    it("reports an issue that is ready because its blocker settled", () => {
        const changes = snapshotChanges(
            config,
            snapshot([blocked(), issue({ id: 2, state: "Todo" })]),
            snapshot([blocked(), issue({ id: 2, state: "Done" })])
        );

        expect(changes.filter((change) => change.kind === "ready")).toEqual([
            { kind: "ready", id: 1, title: "An issue" }
        ]);
    });

    it("counts a cancelled blocker as settled, since it will never complete", () => {
        const changes = snapshotChanges(
            config,
            snapshot([blocked(), issue({ id: 2 })]),
            snapshot([blocked(), issue({ id: 2, state: "Cancelled" })])
        );

        expect(changes.some((change) => change.kind === "ready")).toBe(true);
    });

    it("says nothing about an issue that was already ready", () => {
        const one = snapshot([issue()]);
        const two = snapshot([issue({ assignee: "atlas" })]);

        expect(kinds(snapshotChanges(config, one, two))).toEqual(["assigned"]);
    });

    it("says nothing when the issue itself was just settled", () => {
        // Reaching Done is not becoming ready, however few blockers are left.
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ state: "Done" })])
        );

        expect(changes.some((change) => change.kind === "ready")).toBe(false);
    });
});

describe("who did it", () => {
    const recorded: Event = {
        at: "2026-08-02T09:30:00Z",
        id: 1,
        by: "atlas",
        as: "agent",
        type: "state",
        from: "Todo",
        to: "In Progress"
    };

    it("takes the actor from the log when the log has the transition", () => {
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ state: "In Progress" })], [recorded])
        );

        expect(changes[0]).toMatchObject({ attributed: true });
        expect(changes[0]!.kind === "event" && changes[0]!.event).toMatchObject({
            by: "atlas",
            as: "agent",
            at: "2026-08-02T09:30:00Z"
        });
    });

    /**
     * A file edited by hand records nothing, and that is a change a watcher should still show — which is
     * why detection never depends on the log.
     */
    it("still reports a change the log knows nothing about", () => {
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ state: "In Progress" })], [])
        );

        expect(changes[0]).toMatchObject({ attributed: false });
        expect(changes[0]!.kind === "event" && changes[0]!.event.by).toBe("unknown");
    });

    it("does not reuse an event the previous reading had already seen", () => {
        // Otherwise every subsequent poll would re-attribute, and re-report, the same transition.
        const before = snapshot([issue({ state: "In Progress" })], [recorded]);
        const after = snapshot([issue({ state: "In Progress" })], [recorded]);

        expect(snapshotChanges(config, before, after)).toEqual([]);
    });

    /**
     * Two transitions on one issue in the same burst: the recorded one must not lend its actor to the
     * other. Matching on the issue alone let an assignment nobody logged be credited to whoever moved the
     * state — the two are often the same person, which is exactly why it would have gone unnoticed.
     */
    it("does not attribute one transition using an event about a different change", () => {
        const changes = snapshotChanges(
            config,
            snapshot([issue()]),
            snapshot([issue({ state: "In Progress", assignee: "chris" })], [recorded])
        );

        const state = changes.find(
            (change) => change.kind === "event" && change.event.type === "state"
        );
        const assigned = changes.find(
            (change) => change.kind === "event" && change.event.type === "assigned"
        );

        expect(state).toMatchObject({ attributed: true });
        expect(assigned).toMatchObject({ attributed: false });
        expect(assigned!.kind === "event" && assigned!.event.by).toBe("unknown");
    });

    it("does not attribute a transition to an event about a different issue", () => {
        const elsewhere: Event = { ...recorded, id: 2 };

        const changes = snapshotChanges(
            config,
            snapshot([issue(), issue({ id: 2 })]),
            snapshot([issue({ state: "In Progress" }), issue({ id: 2 })], [elsewhere])
        );

        expect(changes[0]).toMatchObject({ attributed: false });
    });
});

describe("ordering", () => {
    it("reads in the order things happened", () => {
        const early: Event = {
            at: "2026-08-02T09:00:00Z",
            id: 1,
            by: "chris",
            as: "user",
            type: "state",
            from: "Todo",
            to: "In Progress"
        };
        const late: Event = {
            at: "2026-08-02T17:00:00Z",
            id: 2,
            by: "atlas",
            as: "agent",
            type: "state",
            from: "Todo",
            to: "Done"
        };

        const changes = snapshotChanges(
            config,
            snapshot([issue(), issue({ id: 2 })]),
            snapshot(
                [issue({ state: "In Progress" }), issue({ id: 2, state: "Done" })],
                [late, early]
            )
        );

        expect(changes.map((change) => (change.kind === "event" ? change.event.id : 0))).toEqual([
            1, 2
        ]);
    });
});
