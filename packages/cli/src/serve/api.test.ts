import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IssueStore, loadConfigFrom } from "@motte/core";
import { DEFAULT_STATES } from "@motte/core";
import { handleApi, type ApiContext, type ApiResponse } from "./api.js";

/**
 * The JSON API, called directly.
 *
 * No sockets here on purpose: what is decided in `api.ts` is which bodies are accepted and which status
 * code each failure maps to, and none of that needs HTTP to exercise. The socket layer has its own tests
 * for the things only it can get wrong.
 */

let context: ApiContext;

beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "motte-api-"));
    const configPath = join(root, ".motte.config.json");

    writeFileSync(
        configPath,
        JSON.stringify({ name: "Test", issuesDir: ".motte/issues", states: DEFAULT_STATES }),
        "utf8"
    );

    const config = loadConfigFrom(configPath);
    mkdirSync(config.issuesPath, { recursive: true });

    context = { config, store: new IssueStore(config, { name: "Web", type: "user" }) };
});

function call(
    method: string,
    path: string,
    body?: unknown,
    query = ""
): ApiResponse & { json: <T>() => T } {
    const response = handleApi(context, {
        method,
        path,
        query: new URLSearchParams(query),
        ...(body === undefined ? {} : { body })
    });

    return { ...response, json: <T>() => response.body as T };
}

function seed(): void {
    call("POST", "/issues", { title: "Parent", description: "The epic." });
    call("POST", "/issues", { title: "Child", parent: 1, labels: ["core"] });
    call("POST", "/issues", { title: "Other", assignee: "atlas" });
}

describe("GET /api/config", () => {
    it("returns the project name and its configured states", () => {
        const body = call("GET", "/config").json<{ name: string; states: { name: string }[] }>();

        expect(body.name).toBe("Test");
        expect(body.states.map((state) => state.name)).toEqual(["Todo", "In Progress", "Done"]);
    });
});

describe("GET /api/issues", () => {
    beforeEach(seed);

    it("lists every issue with its count", () => {
        const body = call("GET", "/issues").json<{ count: number; issues: { id: number }[] }>();

        expect(body.count).toBe(3);
        expect(body.issues.map((issue) => issue.id)).toEqual([1, 2, 3]);
    });

    /** The board needs to know what cannot be started yet, and that is derived rather than stored. */
    it("includes derived openBlockers and children", () => {
        call("PATCH", "/issues/3", { blockedBy: [1] });

        const body = call("GET", "/issues").json<{
            issues: { id: number; children: number[]; openBlockers: number[] }[];
        }>();

        expect(body.issues.find((issue) => issue.id === 1)!.children).toEqual([2]);
        expect(body.issues.find((issue) => issue.id === 3)!.openBlockers).toEqual([1]);
    });

    it("drops a blocker from openBlockers once it is settled", () => {
        call("PATCH", "/issues/3", { blockedBy: [1] });
        call("PATCH", "/issues/1", { state: "Done" });

        const body = call("GET", "/issues").json<{
            issues: { id: number; openBlockers: number[] }[];
        }>();
        expect(body.issues.find((issue) => issue.id === 3)!.openBlockers).toEqual([]);
    });

    it("filters by state, label, assignee and openness", () => {
        call("PATCH", "/issues/2", { state: "Done" });

        expect(
            call("GET", "/issues", undefined, "state=Done").json<{ count: number }>().count
        ).toBe(1);
        expect(
            call("GET", "/issues", undefined, "label=core").json<{ count: number }>().count
        ).toBe(1);
        expect(
            call("GET", "/issues", undefined, "assignee=atlas").json<{ count: number }>().count
        ).toBe(1);
        expect(call("GET", "/issues", undefined, "open=true").json<{ count: number }>().count).toBe(
            2
        );
    });

    it("matches filters without regard to case", () => {
        expect(
            call("GET", "/issues", undefined, "label=CORE").json<{ count: number }>().count
        ).toBe(1);
        expect(
            call("GET", "/issues", undefined, "assignee=Atlas").json<{ count: number }>().count
        ).toBe(1);
    });
});

describe("POST /api/issues", () => {
    it("creates an issue and returns 201 with the created body", () => {
        const response = call("POST", "/issues", { title: "New", description: "x" });

        expect(response.status).toBe(201);
        expect(response.json<{ id: number; title: string }>().title).toBe("New");
    });

    it("requires a title", () => {
        const response = call("POST", "/issues", { description: "no title" });

        expect(response.status).toBe(400);
        expect(response.json<{ error: string }>().error).toMatch(/title/);
    });

    /**
     * A rejected unknown key rather than a silent one. Accepting `{ titel: "..." }` would answer 200 and
     * change nothing, which is the most confusing outcome available.
     */
    it("rejects an unknown field instead of ignoring it", () => {
        const response = call("POST", "/issues", { title: "Typo", titel: "oops" });

        expect(response.status).toBe(400);
        expect(response.json<{ error: string }>().error).toMatch(/titel|unrecognized/i);
    });

    it("rejects a body that is not an object", () => {
        expect(call("POST", "/issues", "just a string").status).toBe(400);
        expect(call("POST", "/issues").status).toBe(400);
    });

    it("reports an unconfigured state as a bad request", () => {
        const response = call("POST", "/issues", { title: "Odd", state: "Nonsense" });

        expect(response.status).toBe(400);
        expect(response.json<{ error: string }>().error).toMatch(/Nonsense/);
    });

    it("reports a parent that does not exist", () => {
        expect(call("POST", "/issues", { title: "Orphan", parent: 99 }).status).toBe(404);
    });
});

describe("GET /api/issues/:id", () => {
    beforeEach(seed);

    it("returns one issue", () => {
        expect(call("GET", "/issues/2").json<{ title: string }>().title).toBe("Child");
    });

    it("404s an issue that does not exist", () => {
        expect(call("GET", "/issues/99").status).toBe(404);
    });

    /** Title-fragment resolution is a shell convenience; a URL the UI builds should be unambiguous. */
    it("400s a reference that is not a number", () => {
        const response = call("GET", "/issues/child");

        expect(response.status).toBe(400);
        expect(response.json<{ error: string }>().error).toMatch(/not an issue number/);
    });
});

describe("PATCH /api/issues/:id", () => {
    beforeEach(seed);

    it("updates only the fields it is given", () => {
        const body = call("PATCH", "/issues/1", { plan: "1. Do it" }).json<{
            plan: string;
            description: string;
            title: string;
        }>();

        expect(body.plan).toBe("1. Do it");
        expect(body.description).toBe("The epic.");
        expect(body.title).toBe("Parent");
    });

    it("moves state", () => {
        expect(call("PATCH", "/issues/1", { state: "Done" }).json<{ state: string }>().state).toBe(
            "Done"
        );
    });

    /** `null` is how the UI clears a field; omitting it leaves the field alone. */
    it("clears assignee and parent with null", () => {
        call("PATCH", "/issues/2", { assignee: "atlas" });

        const cleared = call("PATCH", "/issues/2", { assignee: null, parent: null }).json<{
            assignee: string | null;
            parent: number | null;
        }>();

        expect(cleared.assignee).toBeNull();
        expect(cleared.parent).toBeNull();
    });

    it("refuses an empty patch rather than bumping updated for nothing", () => {
        const response = call("PATCH", "/issues/1", {});

        expect(response.status).toBe(400);
        expect(response.json<{ error: string }>().error).toMatch(/no fields/);
    });

    it("409s a parent cycle", () => {
        const response = call("PATCH", "/issues/1", { parent: 2 });

        expect(response.status).toBe(409);
        expect(response.json<{ error: string }>().error).toMatch(/cycle/);
    });

    it("409s a dependency cycle", () => {
        call("PATCH", "/issues/2", { blockedBy: [3] });
        const response = call("PATCH", "/issues/3", { blockedBy: [2] });

        expect(response.status).toBe(409);
        expect(response.json<{ error: string }>().error).toMatch(/cycle/);
    });

    it("404s an issue that does not exist", () => {
        expect(call("PATCH", "/issues/99", { title: "Ghost" }).status).toBe(404);
    });
});

describe("POST /api/issues/:id/notes", () => {
    beforeEach(seed);

    it("appends a note attributed to a person by default", () => {
        const response = call("POST", "/issues/1/notes", { body: "A decision." });

        expect(response.status).toBe(201);
        const notes = response.json<{ notes: { body: string; author: { type: string } }[] }>()
            .notes;
        expect(notes.at(-1)!.body).toBe("A decision.");
        // The web UI is a person's surface, so its notes are a person's unless stated otherwise.
        expect(notes.at(-1)!.author.type).toBe("user");
    });

    it("accepts an explicit author and type", () => {
        const response = call("POST", "/issues/1/notes", {
            body: "From an agent.",
            author: "claude",
            authorType: "agent"
        });

        const note = response
            .json<{ notes: { author: { name: string; type: string } }[] }>()
            .notes.at(-1)!;
        expect(note.author).toEqual({ name: "claude", type: "agent" });
    });

    it("requires a body", () => {
        expect(call("POST", "/issues/1/notes", { body: "" }).status).toBe(400);
        expect(call("POST", "/issues/1/notes", {}).status).toBe(400);
    });

    it("404s an issue that does not exist", () => {
        expect(call("POST", "/issues/99/notes", { body: "x" }).status).toBe(404);
    });
});

describe("GET /api/status", () => {
    beforeEach(seed);

    it("reports progress alongside what is ready and what is blocked", () => {
        call("PATCH", "/issues/2", { state: "Done" });
        call("PATCH", "/issues/3", { blockedBy: [1] });

        const body = call("GET", "/status").json<{
            total: number;
            completed: number;
            percentComplete: number;
            ready: number[];
            blocked: number[];
        }>();

        expect(body.total).toBe(3);
        expect(body.completed).toBe(1);
        expect(body.blocked).toEqual([3]);
        expect(body.ready).toContain(1);
    });
});

describe("GET /api/tree", () => {
    beforeEach(seed);

    it("returns the forest", () => {
        const body = call("GET", "/tree").json<{
            roots: { id: number; children: { id: number }[] }[];
        }>();

        expect(body.roots.map((root) => root.id)).toEqual([1, 3]);
        expect(body.roots[0]!.children.map((child) => child.id)).toEqual([2]);
    });

    it("narrows to one subtree with ref", () => {
        const body = call("GET", "/tree", undefined, "ref=1").json<{ roots: { id: number }[] }>();

        expect(body.roots.map((root) => root.id)).toEqual([1]);
    });
});

describe("the shape of failure", () => {
    it("404s an endpoint that does not exist", () => {
        const response = call("GET", "/nonsense");

        expect(response.status).toBe(404);
        expect(response.json<{ error: string }>().error).toMatch(/no such endpoint/);
    });

    it("405s a method the endpoint does not support, naming it", () => {
        seed();

        expect(call("DELETE", "/issues").status).toBe(405);
        expect(call("DELETE", "/issues/1").status).toBe(405);
        expect(call("GET", "/issues/1/notes").status).toBe(405);
    });

    /**
     * Nothing may escape as an exception: the browser is holding a request open, and an uncaught throw
     * would answer it with nothing useful.
     */
    it("never throws, whatever it is handed", () => {
        const nonsense: unknown[] = [null, 0, "", [], { title: 12 }, { blockedBy: ["x"] }];

        for (const body of nonsense) {
            expect(() => call("POST", "/issues", body)).not.toThrow();
            expect(() => call("PATCH", "/issues/1", body)).not.toThrow();
        }
    });
});

describe("the status response", () => {
    /**
     * `projectReport` returns whole `Issue` objects for what is in progress. Passing those through would put
     * `unknownSections` and absolute file paths into an API response — data a client cannot use and should
     * not have to ignore.
     */
    it("reports in-progress work as ids, not whole issues", () => {
        seed();
        call("PATCH", "/issues/1", { state: "In Progress" });

        const body = call("GET", "/status").json<{ inProgress: unknown[] }>();

        expect(body.inProgress).toEqual([1]);
    });

    it("carries no file paths or parser internals", () => {
        seed();
        call("PATCH", "/issues/1", { state: "In Progress" });

        const raw = JSON.stringify(call("GET", "/status").body);

        expect(raw).not.toContain("unknownSections");
        expect(raw).not.toContain(".motte/issues");
    });
});
