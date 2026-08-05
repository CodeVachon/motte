import { describe, expect, it } from "vitest";
import { DEFAULT_STATES, type Change, type Config, type Issue } from "@motte/core";
import {
    changeLine,
    clockOf,
    describeChange,
    frame,
    overviewLines,
    summaryLines,
    type ProjectView
} from "./render.js";

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

/** The single project most of these render against. */
const view: ProjectView = { name: config.name, config, issues: [] };

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
        const line = changeLine(view, stateChange());

        expect(line).toContain("14:02");
        expect(line).toContain("#0001");
        expect(line).toContain("In Progress");
        expect(line).toContain("atlas (agent)");
    });

    /** An unattributed change is one nothing recorded — saying "unknown" would be noise. */
    it("names nobody when the change was not attributed", () => {
        const line = changeLine(view, stateChange({ attributed: false }));

        expect(line).not.toContain("unknown");
    });

    it("takes a note's author from the note itself", () => {
        const line = changeLine(view, {
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
    const model = (changes: Change[] = []) => ({
        projects: [{ ...view, issues: [issue()] }],
        changes: changes.map((change) => ({ project: view, change })),
        live: true
    });

    it("leads with the project and ends with how to stop", () => {
        const lines = frame(model(), { columns: 80, rows: 24 });

        expect(lines[0]).toContain("Test Project");
        expect(lines.at(-1)).toContain("ctrl-c");
    });

    it("says it is waiting before anything has happened", () => {
        expect(frame(model(), { columns: 80, rows: 24 }).join("\n")).toContain("waiting");
    });

    /**
     * A dashboard that scrolled its own header away would be worse than one showing less history, so the
     * stream is what gets cut — and it keeps the newest, which is what somebody watching wants.
     */
    it("cuts the stream to the room left, keeping the most recent", () => {
        const many = Array.from({ length: 40 }, (_, index) =>
            stateChange({ event: { ...stateChange().event, id: index + 1 } })
        );

        const lines = frame(model(many), { columns: 80, rows: 14 });

        expect(lines.length).toBeLessThanOrEqual(14);
        expect(lines.join("\n")).toContain("#0040");
        expect(lines.join("\n")).not.toContain("#0001 ");
    });

    it("fits inside a very small window without throwing", () => {
        const lines = frame(model([stateChange()]), { columns: 40, rows: 6 });

        expect(lines.length).toBeGreaterThan(0);
    });

    it("says when it has stopped watching, since a stale view looks live", () => {
        const lines = frame({ ...model(), live: false }, { columns: 80, rows: 24 });

        expect(lines[0]).toContain("not watching");
    });

    it("shows a read problem in place of the summary", () => {
        const lines = frame(
            { ...model(), problem: "could not read the backlog: nope" },
            { columns: 80, rows: 24 }
        ).join("\n");

        expect(lines).toContain("could not read the backlog");
        expect(lines).not.toContain("nothing in flight");
    });
});

/**
 * Several projects at once.
 *
 * The same renderer, because two that had to agree would drift. What changes is a total on top, a row per
 * project, and a project column on each change line.
 */
describe("watching several projects", () => {
    /** A second project with its own state names, which is the case a shared palette would get wrong. */
    const shipped: Config = {
        ...config,
        name: "Other",
        states: [
            { name: "Backlog", category: "unstarted" },
            { name: "Doing", category: "started" },
            { name: "Shipped", category: "completed" }
        ],
        defaultState: "Backlog",
        root: "/elsewhere"
    };

    const other: ProjectView = { name: "Other", config: shipped, issues: [] };

    describe("overviewLines", () => {
        it("gives a row per project with its own progress", () => {
            const lines = overviewLines([
                { ...view, issues: [issue({ state: "Done" }), issue({ id: 2, state: "Todo" })] },
                { ...other, issues: [issue({ id: 3, state: "Shipped" })] }
            ]).join("\n");

            expect(lines).toContain("Test Project");
            expect(lines).toContain("Other");
            expect(lines).toContain("50%");
            expect(lines).toContain("100%");
        });

        /**
         * Summed from each project's own report rather than by pooling the issues: "Shipped" is completed
         * in one project and not a state at all in the other, and only its own config knows that.
         */
        it("totals across projects that name their states differently", () => {
            const lines = overviewLines([
                { ...view, issues: [issue({ state: "Done" })] },
                { ...other, issues: [issue({ id: 2, state: "Shipped" })] }
            ]).join("\n");

            expect(lines).toContain("2 done");
            expect(lines).toContain("100%");
        });

        it("counts in-flight work under whichever project it belongs to", () => {
            const lines = overviewLines([
                { ...view, issues: [issue({ state: "In Progress", assignee: "atlas" })] },
                { ...other, issues: [issue({ id: 2, state: "Doing", assignee: "claude" })] }
            ]).join("\n");

            expect(lines).toContain("In Progress");
            expect(lines).toContain("atlas");
            expect(lines).toContain("Doing");
            expect(lines).toContain("claude");
        });

        /** A row that silently vanished would read as "nothing happening there". */
        it("keeps a row for a project it could not read, saying so", () => {
            const lines = overviewLines([
                { ...view, issues: [issue()] },
                { ...other, issues: [], problem: "could not read the backlog: nope" }
            ]).join("\n");

            expect(lines).toContain("Other");
            expect(lines).toContain("could not read");
        });

        it("does not divide by zero on an empty backlog", () => {
            expect(overviewLines([{ ...view, issues: [] }]).join("\n")).toContain("0%");
        });
    });

    describe("frame", () => {
        const two = (changes: { project: ProjectView; change: Change }[] = []) => ({
            projects: [
                { ...view, issues: [issue({ state: "In Progress" })] },
                { ...other, issues: [issue({ id: 2, state: "Doing" })] }
            ],
            changes,
            live: true
        });

        it("counts the projects in the header rather than naming one of them", () => {
            const lines = frame(two(), { columns: 80, rows: 24 });

            expect(lines[0]).toContain("2 projects");
        });

        it("names the project on each change line", () => {
            const lines = frame(
                two([
                    { project: view, change: stateChange() },
                    {
                        project: other,
                        change: {
                            kind: "ready",
                            id: 9,
                            title: "Something over there"
                        }
                    }
                ]),
                { columns: 100, rows: 24 }
            ).join("\n");

            expect(lines).toContain("Test Project");
            expect(lines).toContain("Other");
        });

        /**
         * The reason each change carries its project rather than the frame taking one config: a state that
         * only exists in the other project has to render from the other project's states.
         */
        it("renders a change against its own project's states", () => {
            const lines = frame(
                two([
                    {
                        project: other,
                        change: {
                            kind: "event",
                            title: "Over there",
                            attributed: false,
                            event: {
                                at: "2026-08-02T14:02:00Z",
                                id: 2,
                                by: "claude",
                                as: "agent",
                                type: "state",
                                from: "Backlog",
                                to: "Doing"
                            }
                        }
                    }
                ]),
                { columns: 100, rows: 24 }
            ).join("\n");

            expect(lines).toContain("Doing");
        });

        /** Because opening forty watchers without saying so would be the wrong kind of quiet. */
        it("says how many projects it is not watching", () => {
            const lines = frame({ ...two(), omitted: 12 }, { columns: 80, rows: 24 });

            expect(lines[0]).toContain("12 more not watched");
        });

        it("says nothing about omissions when there are none", () => {
            expect(frame({ ...two(), omitted: 0 }, { columns: 80, rows: 24 })[0]).not.toContain(
                "not watched"
            );
        });

        /** One project keeps the old shape exactly: its name, and no redundant project column. */
        it("leads with the project's name when there is only one", () => {
            const lines = frame(
                {
                    projects: [{ ...view, issues: [issue()] }],
                    changes: [{ project: view, change: stateChange() }],
                    live: true
                },
                { columns: 80, rows: 24 }
            );

            expect(lines[0]).toContain("Test Project");
            // Not repeated on the change line, where it would say nothing.
            expect(lines.filter((line) => line.includes("Test Project"))).toHaveLength(1);
        });

        /**
         * The guarantee that was missing. Only the stream was ever cut, so a summary taller than the
         * window overflowed and scrolled the header away — which is the one thing the frame is not
         * allowed to do. Eight projects with work in flight reaches it; so does one project with thirty
         * started issues.
         */
        it("never exceeds the window, whatever it is asked to show", () => {
            const many = {
                projects: Array.from({ length: 12 }, (_, index) => ({
                    ...view,
                    name: `Project ${index}`,
                    issues: [issue({ id: index + 1, state: "In Progress" })]
                })),
                changes: Array.from({ length: 30 }, () => ({
                    project: view,
                    change: stateChange()
                })),
                live: true
            };

            for (const rows of [4, 6, 8, 12, 20, 24, 60]) {
                const lines = frame(many, { columns: 80, rows });

                expect(lines.length, `rows=${rows}`).toBeLessThanOrEqual(rows);
                expect(lines.length, `rows=${rows}`).toBeGreaterThan(0);
                // The header survives, which is the whole point of cutting anything.
                expect(lines[0], `rows=${rows}`).toContain("12 projects");
            }
        });

        it("says how many projects it had to leave off a short window", () => {
            const many = {
                projects: Array.from({ length: 12 }, (_, index) => ({
                    ...view,
                    name: `Project ${index}`,
                    issues: [issue({ id: index + 1 })]
                })),
                changes: [],
                live: true
            };

            expect(frame(many, { columns: 80, rows: 12 }).join("\n")).toMatch(/\+\d+ more/);
        });
    });
});
