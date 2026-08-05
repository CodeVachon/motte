import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initialised, motte } from "../testing/cli.js";

/**
 * `motte import --github owner/repo`, end to end.
 *
 * Against a real HTTP server rather than a stubbed fetch, which is how `fetchVerifiedBinary` is tested for
 * the same reason: the interesting parts are the ones a stub would paper over — pull requests arriving on
 * the issues endpoint, pagination, a second request for comments, and the auth header.
 *
 * The mapping itself is core's, and tested there. What is checked here is that an import lands on disk as
 * real issue files, and that a dry run says what the real run does without writing anything.
 */

interface ApiIssue {
    number: number;
    title: string;
    body?: string | null;
    state: string;
    state_reason?: string | null;
    assignees?: { login: string }[];
    labels?: { name: string }[];
    created_at?: string;
    updated_at?: string;
    comments?: number;
    pull_request?: Record<string, unknown>;
}

let server: Server;
let base: string;
let issues: ApiIssue[] = [];
let comments: Record<number, { user: { login: string }; body: string; created_at: string }[]> = {};
/** Every path the command asked for, so the test can check what it did rather than only what it got. */
let requested: string[] = [];

function issue(overrides: Partial<ApiIssue> = {}): ApiIssue {
    return {
        number: 1,
        title: "Support dark mode",
        body: "The obvious request.",
        state: "open",
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-04-02T11:00:00Z",
        comments: 0,
        ...overrides
    };
}

beforeEach(async () => {
    issues = [];
    comments = {};
    requested = [];

    server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        requested.push(`${url.pathname}${url.search}`);

        // The auth header is part of the contract, so a request without it fails as GitHub's would.
        if (request.headers.authorization !== "Bearer test-token") {
            response.writeHead(401).end("{}");
            return;
        }

        const forComments = /\/issues\/(\d+)\/comments$/.exec(url.pathname);
        if (forComments !== null) {
            response
                .writeHead(200, { "content-type": "application/json" })
                .end(JSON.stringify(comments[Number(forComments[1])] ?? []));
            return;
        }

        if (url.pathname.endsWith("/issues")) {
            const state = url.searchParams.get("state") ?? "open";
            const page = Number(url.searchParams.get("page") ?? "1");
            const perPage = Number(url.searchParams.get("per_page") ?? "100");

            const matching = issues.filter(
                (candidate) => state === "all" || candidate.state === state
            );
            const slice = matching.slice((page - 1) * perPage, page * perPage);

            response
                .writeHead(200, { "content-type": "application/json" })
                .end(JSON.stringify(slice));
            return;
        }

        response.writeHead(404).end("{}");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Add a cancelled state to a project.
 *
 * `motte init` writes Todo/In Progress/Done, so a fresh project has nowhere for "closed as not planned" to
 * go — which is a real configuration, and the reason the mapping falls back to the completed state.
 */
async function withCancelledState(root: string): Promise<string> {
    const path = join(root, ".motte.config.json");
    const config = JSON.parse(readFileSync(path, "utf8")) as {
        states: { name: string; category: string }[];
    };

    config.states.push({ name: "Cancelled", category: "cancelled" });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    return root;
}

/** The environment that routes the command at the local server instead of GitHub. */
function env(): Record<string, string> {
    return { MOTTE_GITHUB_API: base, GITHUB_TOKEN: "test-token" };
}

describe("motte import", () => {
    it("creates a real issue per GitHub issue", async () => {
        issues = [issue({ number: 1 }), issue({ number: 2, title: "Second thing" })];
        const root = await initialised();

        const run = await motte(root, ["import", "--github", "acme/widgets"], env());

        expect(run.code).toBe(0);

        const list = (await motte(root, ["list", "--json"])).json<{
            issues: { id: number; title: string }[];
        }>();

        expect(list.issues.map((created) => created.title)).toEqual([
            "Support dark mode",
            "Second thing"
        ]);
    });

    it("keeps the body, the labels, the assignee and the dates", async () => {
        issues = [
            issue({
                labels: [{ name: "bug" }, { name: "ui" }],
                assignees: [{ login: "octocat" }]
            })
        ];
        const root = await initialised();
        await motte(root, ["import", "--github", "acme/widgets"], env());

        const shown = (await motte(root, ["show", "1", "--json"])).json<{
            description: string;
            labels: string[];
            assignee: string;
            created: string;
        }>();

        expect(shown.description).toContain("The obvious request.");
        expect(shown.labels).toEqual(["bug", "ui"]);
        expect(shown.assignee).toBe("octocat");
        // The GitHub dates, not today's: an imported backlog whose issues were all filed today would be
        // useless for anything that reads age.
        expect(shown.created).toBe("2026-03-01T10:00:00Z");
    });

    it("links back to the original rather than reusing its number", async () => {
        issues = [issue({ number: 137 })];
        const root = await initialised();
        await motte(root, ["import", "--github", "acme/widgets"], env());

        const shown = (await motte(root, ["show", "1", "--json"])).json<{
            id: number;
            description: string;
        }>();

        expect(shown.id).toBe(1);
        expect(shown.description).toContain("acme/widgets#137");
    });

    it("turns comments into notes with their authors and dates", async () => {
        issues = [issue({ comments: 2 })];
        comments = {
            1: [
                {
                    user: { login: "octocat" },
                    body: "Tried it.",
                    created_at: "2026-03-02T09:00:00Z"
                },
                { user: { login: "hubot" }, body: "Me too.", created_at: "2026-03-03T09:00:00Z" }
            ]
        };
        const root = await initialised();
        await motte(root, ["import", "--github", "acme/widgets"], env());

        const notes = (await motte(root, ["show", "1", "--json"])).json<{
            notes: { body: string; at: string; author: { name: string; type: string } }[];
        }>().notes;

        expect(notes.map((note) => note.body)).toEqual(["Tried it.", "Me too."]);
        expect(notes[0]!.author).toEqual({ name: "octocat", type: "user" });
        expect(notes[0]!.at).toBe("2026-03-02T09:00:00Z");
    });

    /** An issue with no comments should cost no request: the count in the payload already says so. */
    it("does not ask for comments an issue does not have", async () => {
        issues = [issue({ comments: 0 })];
        const root = await initialised();
        await motte(root, ["import", "--github", "acme/widgets"], env());

        expect(requested.filter((path) => path.includes("/comments"))).toEqual([]);
    });

    /**
     * The trap in the REST API: the issues endpoint returns pull requests too, so importing without
     * filtering would turn somebody's entire PR history into work to do.
     */
    it("leaves pull requests out", async () => {
        issues = [
            issue({ number: 1, title: "A real issue" }),
            issue({ number: 2, title: "A pull request", pull_request: { url: "..." } })
        ];
        const root = await initialised();
        await motte(root, ["import", "--github", "acme/widgets"], env());

        const list = (await motte(root, ["list", "--json"])).json<{
            issues: { title: string }[];
        }>();

        expect(list.issues.map((created) => created.title)).toEqual(["A real issue"]);
    });

    /**
     * The distinction worth carrying: GitHub separates "closed as completed" from "closed as not planned",
     * and a cancelled state is what keeps the second out of the progress numbers. A project without one
     * gets Done for both, which core's tests cover.
     */
    it("brings closed issues across in the right states, when asked for them", async () => {
        issues = [
            issue({ number: 1, state: "closed", state_reason: "completed", title: "Finished" }),
            issue({ number: 2, state: "closed", state_reason: "not_planned", title: "Abandoned" })
        ];
        const root = await withCancelledState(await initialised());

        await motte(root, ["import", "--github", "acme/widgets", "--state", "all"], env());

        const list = (await motte(root, ["list", "--json"])).json<{
            issues: { title: string; state: string }[];
        }>();

        expect(list.issues).toEqual([
            expect.objectContaining({ title: "Finished", state: "Done" }),
            expect.objectContaining({ title: "Abandoned", state: "Cancelled" })
        ]);
    });

    /** Open by default: a repository with two thousand closed issues is not what somebody wants on day one. */
    it("asks only for open issues unless told otherwise", async () => {
        issues = [issue({ number: 1 }), issue({ number: 2, state: "closed", title: "Closed" })];
        const root = await initialised();

        await motte(root, ["import", "--github", "acme/widgets"], env());

        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
        ).toHaveLength(1);
    });

    it("pages until it has everything", async () => {
        issues = Array.from({ length: 150 }, (_, index) =>
            issue({ number: index + 1, title: `Issue ${index + 1}` })
        );
        const root = await initialised();

        await motte(root, ["import", "--github", "acme/widgets"], env());

        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
        ).toHaveLength(150);
        expect(requested.filter((path) => path.includes("page=2"))).toHaveLength(1);
    });

    it("stops at the limit and says the import is partial", async () => {
        issues = Array.from({ length: 10 }, (_, index) => issue({ number: index + 1 }));
        const root = await initialised();

        const run = await motte(
            root,
            ["import", "--github", "acme/widgets", "--limit", "4"],
            env()
        );

        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
        ).toHaveLength(4);
        expect(run.stdout).toContain("--limit");
    });

    describe("--dry-run", () => {
        it("writes nothing", async () => {
            issues = [issue()];
            const root = await initialised();

            const run = await motte(
                root,
                ["import", "--github", "acme/widgets", "--dry-run"],
                env()
            );

            expect(run.code).toBe(0);
            expect(run.stdout).toContain("Support dark mode");
            expect(
                (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
            ).toEqual([]);
        });

        it("describes the same issues the real run creates", async () => {
            issues = [issue({ number: 1 }), issue({ number: 2, title: "Second" })];
            const root = await initialised();

            const dry = (
                await motte(
                    root,
                    ["import", "--github", "acme/widgets", "--dry-run", "--json"],
                    env()
                )
            ).json<{ wouldImport: { source: number }[] }>();

            const real = (
                await motte(root, ["import", "--github", "acme/widgets", "--json"], env())
            ).json<{ imported: { source: number }[] }>();

            expect(real.imported.map((one) => one.source)).toEqual(
                dry.wouldImport.map((one) => one.source)
            );
        });
    });

    describe("refusals", () => {
        it("refuses something that is not owner/repo", async () => {
            const root = await initialised();

            const run = await motte(root, ["import", "--github", "not a repo"], env());

            expect(run.code).not.toBe(0);
            expect(run.stderr).toContain("owner/repo");
        });

        it("accepts a full GitHub URL, since that is what people copy", async () => {
            issues = [issue()];
            const root = await initialised();

            const run = await motte(
                root,
                ["import", "--github", "https://github.com/acme/widgets", "--dry-run"],
                env()
            );

            expect(run.code).toBe(0);
            expect(run.stdout).toContain("acme/widgets");
        });

        it("says what is missing when there is no token for the API path", async () => {
            const root = await initialised();

            const run = await motte(root, ["import", "--github", "acme/widgets"], {
                MOTTE_GITHUB_API: base,
                GITHUB_TOKEN: "",
                GH_TOKEN: ""
            });

            expect(run.code).not.toBe(0);
            expect(run.stderr).toContain("GITHUB_TOKEN");
        });

        it("reports a rejected token rather than importing nothing quietly", async () => {
            issues = [issue()];
            const root = await initialised();

            const run = await motte(root, ["import", "--github", "acme/widgets"], {
                MOTTE_GITHUB_API: base,
                GITHUB_TOKEN: "wrong"
            });

            expect(run.code).not.toBe(0);
            expect(run.stderr).toContain("401");
        });

        it("says so when the repository has no issues", async () => {
            const root = await initialised();

            const run = await motte(root, ["import", "--github", "acme/widgets"], env());

            expect(run.stdout).toContain("no issues");
        });
    });

    it("says plainly that it is one-way", async () => {
        issues = [issue()];
        const root = await initialised();

        const run = await motte(root, ["import", "--github", "acme/widgets"], env());

        expect(run.stdout).toContain("One-way");
    });
});
