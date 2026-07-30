import { describe, expect, it } from "vitest";
import { DEFAULT_STATES, type Config, type Event, type Issue } from "@motte/core";
import {
    blockerProblems,
    eventLogProblems,
    hierarchyProblems,
    issueFileProblems,
    roundTripProblems,
    staleProblems,
    unparseableProblems
} from "./doctor.js";

/**
 * The checks in isolation, with no project on disk.
 *
 * These used to be unreachable: all seven lived inline in the command handler, so the only way to exercise
 * a check was to build a broken backlog in a temp directory and run the CLI against it. That is still worth
 * doing for the wiring, and `cli.test.ts` does it, but it makes the awkward cases — a blocker that does not
 * exist, an event log with no events at all — expensive to set up and easy to leave untested.
 */

const DAY = 86400_000;

function config(states = DEFAULT_STATES): Config {
    return {
        name: "Test",
        issuesDir: ".motte/issues",
        states,
        defaultState: "Todo",
        root: "/nowhere",
        configPath: "/nowhere/.motte.config.json",
        issuesPath: "/nowhere/.motte/issues",
        events: { enabled: true }
    };
}

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        created: "2026-07-01T00:00:00Z",
        updated: "2026-07-01T00:00:00Z",
        description: "Describe.",
        plan: "",
        notes: [],
        unknownSections: [],
        filePath: "/nowhere/.motte/issues/0001-an-issue.md",
        ...overrides
    };
}

/**
 * Events use short keys — `at`/`id`/`by`/`as` — because they are written once per transition and never
 * edited, so repeated key names are a real fraction of the file at scale. My first fixture here invented
 * `issue` and `actor`, which typechecked only because I had cast it, and the resulting failure looked like
 * a bug in `staleProblems`.
 */
function stateEvent(id: number, from: string, to: string, at: string): Event {
    return { at, id, by: "claude", as: "agent", type: "state", from, to };
}

describe("unparseableProblems", () => {
    it("reports each broken file as an error", () => {
        const problems = unparseableProblems([
            { filePath: "/a/0099-bad.md", message: "missing YAML frontmatter" }
        ]);

        expect(problems).toEqual([
            {
                severity: "error",
                kind: "unparseable",
                message: "missing YAML frontmatter",
                file: "/a/0099-bad.md"
            }
        ]);
    });

    it("says nothing when there are none", () => {
        expect(unparseableProblems([])).toEqual([]);
    });
});

describe("roundTripProblems", () => {
    it("names the issue and hints at the cause", () => {
        const problems = roundTripProblems([issue({ id: 7 })]);

        expect(problems).toHaveLength(1);
        expect(problems[0]!.severity).toBe("error");
        expect(problems[0]!.kind).toBe("not-round-trippable");
        expect(problems[0]!.message).toContain("#7");
        expect(problems[0]!.message).toMatch(/needs quoting/);
    });
});

describe("hierarchyProblems", () => {
    it("reports a missing parent", () => {
        const problems = hierarchyProblems([issue({ id: 1, parent: 99 })]);

        expect(problems.map((problem) => problem.kind)).toContain("missing-parent");
        expect(problems.every((problem) => problem.severity === "error")).toBe(true);
    });

    it("reports a cycle", () => {
        const problems = hierarchyProblems([
            issue({ id: 1, parent: 2 }),
            issue({ id: 2, parent: 1 })
        ]);

        expect(problems.map((problem) => problem.kind)).toContain("cycle");
    });

    it("says nothing about a well-formed tree", () => {
        expect(hierarchyProblems([issue({ id: 1 }), issue({ id: 2, parent: 1 })])).toEqual([]);
    });
});

describe("staleProblems", () => {
    const started = issue({ id: 3, state: "In Progress" });

    it("warns about work started longer ago than the limit", () => {
        const events = [stateEvent(3, "Todo", "In Progress", "2026-07-01T00:00:00Z")];
        const problems = staleProblems(config(), [started], events, 7);

        expect(problems).toHaveLength(1);
        expect(problems[0]!.severity).toBe("warning");
        expect(problems[0]!.kind).toBe("stale-started");
        expect(problems[0]!.message).toMatch(/#3 has been in "In Progress" for \d+ days/);
    });

    /**
     * Zero disables the check. Worth pinning: the handler passes the flag straight through, so an
     * off-by-one here would either warn about everything or never warn at all.
     */
    it("is disabled by a limit of zero", () => {
        const events = [stateEvent(3, "Todo", "In Progress", "2026-07-01T00:00:00Z")];
        expect(staleProblems(config(), [started], events, 0)).toEqual([]);
    });

    /**
     * Without the log there is no transition history, so every started issue would look ageless. Staying
     * quiet is the correct answer, not warning about all of them.
     */
    it("stays quiet when the log is empty", () => {
        expect(staleProblems(config(), [started], [], 7)).toEqual([]);
    });

    it("ignores issues that are not in a started state", () => {
        const done = issue({ id: 4, state: "Done" });
        const events = [stateEvent(4, "In Progress", "Done", "2026-07-01T00:00:00Z")];

        expect(staleProblems(config(), [done], events, 7)).toEqual([]);
    });

    it("says nothing about work started more recently than the limit", () => {
        const recent = new Date(Date.now() - 2 * DAY).toISOString().replace(/\.\d+Z$/, "Z");
        const events = [stateEvent(3, "Todo", "In Progress", recent)];

        expect(staleProblems(config(), [started], events, 7)).toEqual([]);
    });
});

describe("eventLogProblems", () => {
    it("warns rather than errors, since the issue files remain the source of truth", () => {
        const problems = eventLogProblems([
            { file: "2026-07.claude.ndjson", line: 12, message: "invalid JSON" }
        ]);

        expect(problems[0]!.severity).toBe("warning");
        expect(problems[0]!.message).toBe("2026-07.claude.ndjson line 12: invalid JSON");
    });

    /** Line 0 means the problem is with the file rather than a line in it, so the number is omitted. */
    it("omits the line number when there is none", () => {
        const problems = eventLogProblems([
            { file: "2026-07.claude.ndjson", line: 0, message: "unreadable" }
        ]);

        expect(problems[0]!.message).toBe("2026-07.claude.ndjson: unreadable");
    });
});

describe("blockerProblems", () => {
    it("errors on a blocker that does not exist", () => {
        const problems = blockerProblems(config(), [issue({ id: 1, blockedBy: [99] })]);

        expect(problems).toHaveLength(1);
        expect(problems[0]!.severity).toBe("error");
    });

    /** Starting something still blocked is a judgement call, so it must not fail the build. */
    it("only warns about work started while blocked", () => {
        const problems = blockerProblems(config(), [
            issue({ id: 1, state: "Todo" }),
            issue({ id: 2, state: "In Progress", blockedBy: [1] })
        ]);

        expect(problems.map((problem) => problem.kind)).toContain("started-while-blocked");
        expect(problems.find((problem) => problem.kind === "started-while-blocked")!.severity).toBe(
            "warning"
        );
    });
});

describe("issueFileProblems", () => {
    it("errors on a state that is not configured", () => {
        const problems = issueFileProblems(config(), [issue({ state: "Blocked" })]);

        expect(problems).toHaveLength(1);
        expect(problems[0]!.kind).toBe("unknown-state");
        expect(problems[0]!.message).toContain("Todo, In Progress, Done");
    });

    it("errors when the filename claims a different id from the frontmatter", () => {
        const problems = issueFileProblems(config(), [
            issue({ id: 5, filePath: "/a/0009-mismatched.md" })
        ]);

        expect(problems[0]!.kind).toBe("filename");
        expect(problems[0]!.severity).toBe("error");
        expect(problems[0]!.message).toContain("claims #9");
    });

    it("warns when the filename has no id prefix at all", () => {
        const problems = issueFileProblems(config(), [issue({ filePath: "/a/notes.md" })]);

        expect(problems[0]!.kind).toBe("filename");
        expect(problems[0]!.severity).toBe("warning");
    });

    it("warns about an empty description, including one that is only whitespace", () => {
        expect(issueFileProblems(config(), [issue({ description: "" })])[0]!.kind).toBe(
            "empty-description"
        );
        expect(issueFileProblems(config(), [issue({ description: "  \n " })])[0]!.kind).toBe(
            "empty-description"
        );
    });

    it("says nothing about a well-formed issue", () => {
        expect(issueFileProblems(config(), [issue()])).toEqual([]);
    });

    /** An issue not yet written has no path, so the filename checks must skip rather than throw. */
    it("skips the filename checks for an unwritten issue", () => {
        const problems = issueFileProblems(config(), [issue({ filePath: undefined })]);

        expect(problems.filter((problem) => problem.kind === "filename")).toEqual([]);
    });
});
