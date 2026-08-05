import { describe, expect, it } from "vitest";
import { escapeSections, planImport, referenceLine, stateFor } from "./github.js";
import { formatIssueFile, parseIssueFile } from "./serialize.js";
import type { Issue } from "./schema/issue.js";
import type { GithubIssue } from "./github.js";
import { DEFAULT_STATES } from "./schema/config.js";
import type { Config } from "./schema/config.js";

/**
 * Turning GitHub issues into motte ones.
 *
 * Pure, so every mapping decision is checked here without a network or a token: what state a closed issue
 * lands in, what happens to the comments, and what an imported issue says about where it came from.
 */

function project(
    states = [...DEFAULT_STATES, { name: "Cancelled", category: "cancelled" }]
): Config {
    return {
        name: "test",
        issuesDir: ".motte/issues",
        states,
        defaultState: "Todo",
        root: "/nowhere",
        configPath: "/nowhere/.motte.config.json",
        issuesPath: "/nowhere/.motte/issues",
        events: { enabled: true }
    } as Config;
}

function ghIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
    return {
        number: 42,
        title: "Support dark mode",
        body: "The obvious request.",
        state: "OPEN",
        createdAt: "2026-03-01T10:00:00Z",
        updatedAt: "2026-04-02T11:00:00Z",
        ...overrides
    };
}

const REPO = "acme/widgets";

describe("stateFor", () => {
    it("puts an open issue in the default state", () => {
        expect(stateFor(project(), ghIssue())).toBe("Todo");
    });

    it("puts a closed issue in the completed state", () => {
        expect(stateFor(project(), ghIssue({ state: "CLOSED" }))).toBe("Done");
    });

    /**
     * The distinction worth carrying across. GitHub separates "closed as completed" from "closed as not
     * planned", and motte's cancelled category is that difference — work that leaves the denominator
     * rather than counting as finished. Importing both as Done inflates every report from day one.
     */
    it("puts a not-planned issue in the cancelled state", () => {
        const issue = ghIssue({ state: "CLOSED", stateReason: "NOT_PLANNED" });

        expect(stateFor(project(), issue)).toBe("Cancelled");
    });

    it("falls back to completed when the project has no cancelled state", () => {
        const issue = ghIssue({ state: "CLOSED", stateReason: "NOT_PLANNED" });

        expect(stateFor(project(DEFAULT_STATES), issue)).toBe("Done");
    });

    /** By category, not by name, so a project that renamed Done to Shipped still imports correctly. */
    it("finds the completed state whatever it is called", () => {
        const renamed = project([
            { name: "Backlog", category: "unstarted" },
            { name: "Shipped", category: "completed" }
        ]);

        expect(
            stateFor({ ...renamed, defaultState: "Backlog" }, ghIssue({ state: "CLOSED" }))
        ).toBe("Shipped");
    });

    it("accepts either case from either source", () => {
        expect(stateFor(project(), ghIssue({ state: "closed" }))).toBe("Done");
        expect(stateFor(project(), ghIssue({ state: "closed", stateReason: "not_planned" }))).toBe(
            "Cancelled"
        );
    });

    /** A reopened issue is open, whatever reason it carries. */
    it("treats a reopened issue as open", () => {
        expect(stateFor(project(), ghIssue({ state: "OPEN", stateReason: "REOPENED" }))).toBe(
            "Todo"
        );
    });
});

describe("referenceLine", () => {
    it("links to the original", () => {
        expect(referenceLine(REPO, ghIssue())).toBe(
            "Imported from [acme/widgets#42](https://github.com/acme/widgets/issues/42)."
        );
    });

    it("uses the url GitHub gave, when it gave one", () => {
        const line = referenceLine(REPO, ghIssue({ url: "https://github.example/x/y/issues/42" }));

        expect(line).toContain("https://github.example/x/y/issues/42");
    });
});

describe("planImport", () => {
    it("carries the title, body, labels, assignee and dates across", () => {
        const plan = planImport(
            project(),
            [
                ghIssue({
                    labels: ["bug", "ui"],
                    assignees: ["octocat"]
                })
            ],
            { repo: REPO }
        );

        const [only] = plan.issues;
        expect(only?.title).toBe("Support dark mode");
        expect(only?.description).toContain("The obvious request.");
        expect(only?.labels).toEqual(["bug", "ui"]);
        expect(only?.assignee).toBe("octocat");
        expect(only?.created).toBe("2026-03-01T10:00:00Z");
        expect(only?.updated).toBe("2026-04-02T11:00:00Z");
    });

    /**
     * The number is a reference, not the new id: reusing it would collide with the ids a project already
     * has, and a partial import would leave gaps that look like prunes.
     */
    it("keeps the GitHub number in the body rather than as the id", () => {
        const plan = planImport(project(), [ghIssue({ number: 7 })], { repo: REPO });

        expect(plan.issues[0]?.description).toContain("acme/widgets#7");
        expect(plan.issues[0]?.source).toBe(7);
    });

    it("still records where an issue with no body came from", () => {
        const plan = planImport(project(), [ghIssue({ body: "" })], { repo: REPO });

        expect(plan.issues[0]?.description).toBe(referenceLine(REPO, ghIssue({ body: "" })));
    });

    it("orders by GitHub number, so the new ids run the same way", () => {
        const plan = planImport(
            project(),
            [ghIssue({ number: 9 }), ghIssue({ number: 2 }), ghIssue({ number: 5 })],
            { repo: REPO }
        );

        expect(plan.issues.map((issue) => issue.source)).toEqual([2, 5, 9]);
    });

    it("takes the first assignee, since motte holds one", () => {
        const plan = planImport(project(), [ghIssue({ assignees: ["first", "second"] })], {
            repo: REPO
        });

        expect(plan.issues[0]?.assignee).toBe("first");
    });

    it("de-duplicates labels", () => {
        const plan = planImport(project(), [ghIssue({ labels: ["bug", "bug", "ui"] })], {
            repo: REPO
        });

        expect(plan.issues[0]?.labels).toEqual(["bug", "ui"]);
    });

    it("gives an issue with no title something to be called", () => {
        const plan = planImport(project(), [ghIssue({ title: "   " })], { repo: REPO });

        expect(plan.issues[0]?.title).toBe("Imported issue #42");
    });

    describe("comments", () => {
        it("become notes keeping their author and date", () => {
            const plan = planImport(
                project(),
                [
                    ghIssue({
                        comments: [
                            {
                                author: "octocat",
                                body: "Tried this, it did not work.",
                                createdAt: "2026-03-02T09:00:00Z"
                            }
                        ]
                    })
                ],
                { repo: REPO }
            );

            expect(plan.issues[0]?.notes).toEqual([
                {
                    at: "2026-03-02T09:00:00Z",
                    author: { name: "octocat", type: "user" },
                    body: "Tried this, it did not work."
                }
            ]);
        });

        /** Counted rather than dropped in silence, so the report can say the import left something out. */
        it("are left out when GitHub had hidden them, and counted", () => {
            const plan = planImport(
                project(),
                [
                    ghIssue({
                        comments: [
                            { author: "spammer", body: "buy things", minimized: true },
                            { author: "octocat", body: "the real one" }
                        ]
                    })
                ],
                { repo: REPO }
            );

            expect(plan.issues[0]?.notes.map((note) => note.body)).toEqual(["the real one"]);
            expect(plan.hiddenComments).toBe(1);
        });

        it("skips an empty comment rather than writing a blank note", () => {
            const plan = planImport(project(), [ghIssue({ comments: [{ body: "   " }] })], {
                repo: REPO
            });

            expect(plan.issues[0]?.notes).toEqual([]);
        });

        it("names an author it was not given, rather than leaving it blank", () => {
            const plan = planImport(project(), [ghIssue({ comments: [{ body: "orphaned" }] })], {
                repo: REPO
            });

            expect(plan.issues[0]?.notes[0]?.author.name).toBe("unknown");
        });
    });

    describe("sub-issues", () => {
        it("become parent and child", () => {
            const plan = planImport(
                project(),
                [ghIssue({ number: 1 }), ghIssue({ number: 2, parent: 1 })],
                { repo: REPO }
            );

            expect(plan.issues[1]?.parent).toBe(1);
            expect(plan.hierarchy).toBe(1);
        });

        /**
         * A parent left out by the filters, or living in another repository, would otherwise become a
         * dangling reference — so the child arrives as a root instead.
         */
        it("are dropped when the parent is not being imported", () => {
            const plan = planImport(project(), [ghIssue({ number: 2, parent: 99 })], {
                repo: REPO
            });

            expect(plan.issues[0]?.parent).toBeUndefined();
            expect(plan.hierarchy).toBe(0);
        });

        it("can be flattened on request", () => {
            const plan = planImport(
                project(),
                [ghIssue({ number: 1 }), ghIssue({ number: 2, parent: 1 })],
                { repo: REPO, hierarchy: false }
            );

            expect(plan.issues[1]?.parent).toBeUndefined();
        });
    });

    it("rejects nothing and returns nothing for an empty repository", () => {
        expect(planImport(project(), [], { repo: REPO })).toEqual({
            issues: [],
            hiddenComments: 0,
            hierarchy: 0
        });
    });
});

/**
 * An imported body must survive the format it is being written into.
 *
 * `## ` at the start of a line is what divides an issue file into sections, and a GitHub body is full of
 * them. Found by importing four real issues from cli/cli and then asking what would happen to a body that
 * used motte's own headings — the answers were bad enough to be worth pinning here.
 */
describe("escaping an imported body", () => {
    function roundTrip(description: string): Issue {
        const issue: Issue = {
            id: 1,
            title: "Imported",
            state: "Todo",
            created: "2026-01-01T00:00:00Z",
            updated: "2026-01-01T00:00:00Z",
            description,
            plan: "",
            notes: [],
            unknownSections: []
        };

        return parseIssueFile(formatIssueFile(issue), "/x.md");
    }

    function imported(body: string): string {
        return planImport(project(), [ghIssue({ body })], { repo: REPO }).issues[0]!.description;
    }

    it("demotes a heading rather than letting it split the description", () => {
        expect(escapeSections("text\n\n## Notes\n\nmore")).toBe("text\n\n### Notes\n\nmore");
    });

    /**
     * Indenting would also stop the parser and change nothing visible — but section content is trimmed on
     * the way in and out, so a leading space on the first line does not survive the next read.
     */
    it("escapes a heading on the very first line, where indentation could not survive", () => {
        const back = roundTrip(imported("## Notes\n\nthe whole body"));

        expect(back.notes).toEqual([]);
        expect(back.description).toContain("the whole body");
    });

    it("leaves ordinary text and deeper headings alone", () => {
        const body = "text\n### Deeper\n#### Deeper still\nnot ## a heading";

        expect(escapeSections(body)).toBe(body);
    });

    /** Would otherwise have become real motte notes, attributed to people who never wrote one. */
    it("keeps a body using `## Notes` in the description, and creates no notes", () => {
        const back = roundTrip(
            imported(
                "Some text\n\n## Notes\n\n### 2026-05-05T00:00:00Z — someone (user)\n\nnot a note"
            )
        );

        expect(back.notes).toEqual([]);
        expect(back.description).toContain("# Notes");
        expect(back.description).toContain("not a note");
    });

    it("keeps a body using `## Plan` out of the plan", () => {
        const back = roundTrip(imported("Some text\n\n## Plan\n\n1. Their plan"));

        expect(back.plan).toBe("");
        expect(back.description).toContain("1. Their plan");
    });

    /**
     * The worst of the three: this produced a file motte itself refused to parse, so an issue it had just
     * created came back from `motte list` as a broken file.
     */
    it("survives a reserved heading inside a code fence", () => {
        const back = roundTrip(imported("text\n\n```md\n## Notes\n```\n\nmore"));

        expect(back.description).toContain("# Notes");
        expect(back.description).toContain("more");
    });

    it("keeps an ordinary GitHub heading in the description rather than moving it to the end", () => {
        const back = roundTrip(
            imported("## Steps to reproduce\n\n1. Do the thing\n\n## Expected\n\nIt works")
        );

        expect(back.unknownSections).toEqual([]);
        expect(back.description).toContain("Steps to reproduce");
        expect(back.description).toContain("Expected");
        // In the order they were written, which is what moving them to a trailing section would have lost.
        expect(back.description.indexOf("Steps")).toBeLessThan(
            back.description.indexOf("Expected")
        );
    });

    it("still round-trips byte-for-byte, which is the format's one hard guarantee", () => {
        const description = imported(
            "## Notes\n\n```\n## Plan\n```\n\n### 2026-01-01T00:00:00Z — x (user)"
        );
        const issue: Issue = {
            id: 1,
            title: "Imported",
            state: "Todo",
            created: "2026-01-01T00:00:00Z",
            updated: "2026-01-01T00:00:00Z",
            description,
            plan: "",
            notes: [],
            unknownSections: []
        };

        const text = formatIssueFile(issue);
        expect(formatIssueFile(parseIssueFile(text, "/x.md"))).toBe(text);
    });
});
