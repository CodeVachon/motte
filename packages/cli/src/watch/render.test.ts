import { describe, expect, it } from "vitest";
import { DEFAULT_STATES, type Change, type Config, type Issue } from "@motte/core";
import { changeLine, clockOf, describeChange, frame, summaryLines } from "./render.js";

/**
 * What the dashboard says.
 *
 * Separate from the terminal mechanics, so the parts worth checking — how a transition reads, and what a
 * frame drops when the window is small — need no terminal at all.
 */

const config: Config = {
    name: "Test Project",
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
        title: "Write the parser",
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

/** Narrowed to the event-shaped changes, so a test can reach into `.event` without casting. */
type EventChange = Extract<Change, { kind: "event" }>;

function stateChange(overrides: Partial<EventChange> = {}): EventChange {
    return {
        kind: "event",
        title: "Write the parser",
        attributed: true,
        event: {
            at: "2026-08-02T14:02:00Z",
            id: 1,
            by: "atlas",
            as: "agent",
            type: "state",
            from: "Todo",
            to: "In Progress"
        },
        ...overrides
    };
}

describe("clockOf", () => {
    /** Sliced rather than parsed, so a timestamp reads the same here as it does in `motte log`. */
    it("takes the time out of an ISO timestamp without shifting it", () => {
        expect(clockOf("2026-08-02T14:02:11Z")).toBe("14:02");
    });

    it("gives a placeholder for something it cannot read", () => {
        expect(clockOf("")).toBe("--:--");
        expect(clockOf("yesterday")).toBe("--:--");
    });
});

describe("describeChange", () => {
    it("reads a state change as both ends of it", () => {
        expect(describeChange(config, stateChange())).toContain("Todo");
        expect(describeChange(config, stateChange())).toContain("In Progress");
    });

    it("names what happened for every kind", () => {
        const cases: [Change, RegExp][] = [
            [
                stateChange({
                    event: {
                        at: "2026-08-02T14:00:00Z",
                        id: 1,
                        by: "chris",
                        as: "user",
                        type: "created",
                        title: "Write the parser",
                        state: "Todo"
                    }
                }),
                /created/
            ],
            [
                {
                    kind: "note",
                    id: 1,
                    title: "Write the parser",
                    note: {
                        at: "2026-08-02T14:05:00Z",
                        author: { name: "atlas", type: "agent" },
                        body: "Looked at it."
                    }
                },
                /note/
            ],
            [{ kind: "ready", id: 2, title: "Ship it" }, /ready/],
            [{ kind: "removed", id: 3, title: "Gone" }, /removed/]
        ];

        for (const [change, expected] of cases) {
            expect(describeChange(config, change)).toMatch(expected);
        }
    });

    it("shortens a long note rather than wrapping the stream", () => {
        const change: Change = {
            kind: "note",
            id: 1,
            title: "Write the parser",
            note: {
                at: "2026-08-02T14:05:00Z",
                author: { name: "atlas", type: "agent" },
                body: "a".repeat(200)
            }
        };

        expect(describeChange(config, change)).toContain("…");
        expect(describeChange(config, change).length).toBeLessThan(120);
    });

    it("collapses a note written over several lines", () => {
        const change: Change = {
            kind: "note",
            id: 1,
            title: "Write the parser",
            note: {
                at: "2026-08-02T14:05:00Z",
                author: { name: "atlas", type: "agent" },
                body: "first\n\nsecond"
            }
        };

        expect(describeChange(config, change)).toContain("first second");
    });
});

describe("changeLine", () => {
    it("carries the time, the issue, what happened and who did it", () => {
        const line = changeLine(config, stateChange());

        expect(line).toContain("14:02");
        expect(line).toContain("#0001");
        expect(line).toContain("In Progress");
        expect(line).toContain("atlas (agent)");
    });

    /** An unattributed change is one nothing recorded — saying "unknown" would be noise. */
    it("names nobody when the change was not attributed", () => {
        const line = changeLine(config, stateChange({ attributed: false }));

        expect(line).not.toContain("unknown");
    });

    it("takes a note's author from the note itself", () => {
        const line = changeLine(config, {
            kind: "note",
            id: 1,
            title: "Write the parser",
            note: {
                at: "2026-08-02T15:00:00Z",
                author: { name: "Chris", type: "user" },
                body: "Mine."
            }
        });

        expect(line).toContain("Chris (user)");
        expect(line).toContain("15:00");
    });
});

describe("summaryLines", () => {
    it("says so when nothing is in flight", () => {
        expect(summaryLines(config, [issue()]).join("\n")).toContain("nothing in flight");
    });

    it("lists started issues with whoever has them", () => {
        const lines = summaryLines(config, [
            issue({ id: 1, state: "In Progress", assignee: "atlas" }),
            issue({ id: 2, title: "Ship it", state: "Todo" })
        ]).join("\n");

        expect(lines).toContain("#0001");
        expect(lines).toContain("atlas");
        // Only what is moving: a Todo issue is not in flight.
        expect(lines).not.toContain("#0002");
    });

    /** In flight means started, whether or not anybody claimed it. */
    it("includes an unassigned started issue", () => {
        expect(summaryLines(config, [issue({ state: "In Progress" })]).join("\n")).toContain(
            "#0001"
        );
    });
});

describe("frame", () => {
    const model = (changes: Change[] = []) => ({ issues: [issue()], changes, live: true });

    it("leads with the project and ends with how to stop", () => {
        const lines = frame(config, model(), { columns: 80, rows: 24 });

        expect(lines[0]).toContain("Test Project");
        expect(lines.at(-1)).toContain("ctrl-c");
    });

    it("says it is waiting before anything has happened", () => {
        expect(frame(config, model(), { columns: 80, rows: 24 }).join("\n")).toContain("waiting");
    });

    /**
     * A dashboard that scrolled its own header away would be worse than one showing less history, so the
     * stream is what gets cut — and it keeps the newest, which is what somebody watching wants.
     */
    it("cuts the stream to the room left, keeping the most recent", () => {
        const many = Array.from({ length: 40 }, (_, index) =>
            stateChange({ event: { ...stateChange().event, id: index + 1 } })
        );

        const lines = frame(config, model(many), { columns: 80, rows: 14 });

        expect(lines.length).toBeLessThanOrEqual(14);
        expect(lines.join("\n")).toContain("#0040");
        expect(lines.join("\n")).not.toContain("#0001 ");
    });

    it("fits inside a very small window without throwing", () => {
        const lines = frame(config, model([stateChange()]), { columns: 40, rows: 6 });

        expect(lines.length).toBeGreaterThan(0);
    });

    it("says when it has stopped watching, since a stale view looks live", () => {
        const lines = frame(config, { ...model(), live: false }, { columns: 80, rows: 24 });

        expect(lines[0]).toContain("not watching");
    });

    it("shows a read problem in place of the summary", () => {
        const lines = frame(
            config,
            { ...model(), problem: "could not read the backlog: nope" },
            { columns: 80, rows: 24 }
        ).join("\n");

        expect(lines).toContain("could not read the backlog");
        expect(lines).not.toContain("nothing in flight");
    });
});
