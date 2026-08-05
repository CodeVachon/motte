import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FrontmatterSchema } from "@motte/core";
import { createMotteServer } from "./server.js";
import { issueJson } from "../context.js";

/**
 * Drives the server over an in-memory transport — the same code path a real client takes, without
 * spawning a process or touching stdio.
 */
async function connect(cwd: string, agent?: string): Promise<Client> {
    const server = createMotteServer(agent === undefined ? { cwd } : { cwd, agent });
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
}

interface CallResult {
    isError: boolean;
    text: string;
    json: <T = Record<string, unknown>>() => T;
}

async function call(
    client: Client,
    name: string,
    args: Record<string, unknown> = {}
): Promise<CallResult> {
    const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
    };

    const text = result.content.map((part) => part.text).join("\n");
    return { isError: result.isError === true, text, json: () => JSON.parse(text) };
}

function project(): string {
    const root = mkdtempSync(join(tmpdir(), "motte-mcp-"));
    mkdirSync(join(root, ".motte", "issues"), { recursive: true });
    writeFileSync(
        join(root, ".motte.config.json"),
        JSON.stringify({
            name: "Test",
            states: [
                { name: "Todo", category: "unstarted" },
                { name: "In Progress", category: "started" },
                { name: "Done", category: "completed" },
                { name: "Cancelled", category: "cancelled" }
            ]
        })
    );
    return root;
}

describe("handshake", () => {
    it("advertises every tool", async () => {
        const client = await connect(project());
        const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

        expect(names).toEqual(
            [
                "add_note",
                "breakdown",
                "claim_issue",
                "create_issue",
                "get_issue",
                "list_issues",
                "next_issue",
                "ready_issues",
                "release_issue",
                "search_issues",
                "set_blockers",
                "set_parent",
                "set_state",
                "status_report",
                "tree",
                "update_issue"
            ].sort()
        );
    });

    it("sends instructions that start the agent at next_issue and claiming", async () => {
        const client = await connect(project());
        const instructions = client.getInstructions() ?? "";

        expect(instructions).toContain("next_issue");
        // The step an agent will skip unless told, and skipping it is what puts two of them on one issue.
        expect(instructions).toContain("claim_issue");
        expect(instructions).toContain("release_issue");
        expect(instructions.length).toBeGreaterThan(200);
    });

    it("marks read-only tools as such, so a client can treat them differently", async () => {
        const client = await connect(project());
        const tools = (await client.listTools()).tools;
        const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true);

        expect(readOnly.map((tool) => tool.name).sort()).toEqual([
            "get_issue",
            "list_issues",
            "next_issue",
            "ready_issues",
            "search_issues",
            "status_report",
            "tree"
        ]);
    });
});

describe("without a project", () => {
    it("still starts, and reports the missing project as a tool error", async () => {
        // A server that fails to start looks broken in the client with no explanation. One that starts
        // and explains itself tells the agent what to do.
        const empty = mkdtempSync(join(tmpdir(), "motte-none-"));
        const client = await connect(empty);
        const result = await call(client, "ready_issues");

        expect(result.isError).toBe(true);
        expect(result.text).toContain("motte init");
    });
});

describe("reading", () => {
    let root: string;
    let client: Client;

    beforeEach(async () => {
        root = project();
        client = await connect(root);
        await call(client, "create_issue", { title: "Build the parser", description: "First." });
        await call(client, "create_issue", { title: "Write the tests" });
        await call(client, "set_blockers", { ref: 2, blockedBy: [1] });
    });

    it("ready_issues excludes work that is still blocked", async () => {
        const result = await call(client, "ready_issues");
        expect(result.json<{ issues: { id: number }[] }>().issues.map((i) => i.id)).toEqual([1]);
    });

    it("ready_issues includes the dependent once its blocker is done", async () => {
        await call(client, "set_state", { ref: 1, state: "done" });
        const result = await call(client, "ready_issues");

        expect(result.json<{ issues: { id: number }[] }>().issues.map((i) => i.id)).toEqual([2]);
    });

    it("get_issue accepts a title fragment as well as an id", async () => {
        expect((await call(client, "get_issue", { ref: "parser" })).json<{ id: number }>().id).toBe(
            1
        );
        expect((await call(client, "get_issue", { ref: 1 })).json<{ id: number }>().id).toBe(1);
    });

    it("get_issue reports open blockers separately from the raw list", async () => {
        const blocked = (await call(client, "get_issue", { ref: 2 })).json<{
            blockedBy: number[];
            openBlockers: number[];
        }>();

        expect(blocked.blockedBy).toEqual([1]);
        expect(blocked.openBlockers).toEqual([1]);

        await call(client, "set_state", { ref: 1, state: "done" });
        const after = (await call(client, "get_issue", { ref: 2 })).json<{
            blockedBy: number[];
            openBlockers: number[];
        }>();

        // The dependency is still recorded; it is simply no longer standing in the way.
        expect(after.blockedBy).toEqual([1]);
        expect(after.openBlockers).toEqual([]);
    });

    it("list_issues filters and reports the configured states", async () => {
        const all = (await call(client, "list_issues")).json<{ count: number; states: string[] }>();
        expect(all.count).toBe(2);
        expect(all.states).toContain("In Progress");

        const blocked = (await call(client, "list_issues", { blocked: true })).json<{
            issues: { id: number }[];
        }>();
        expect(blocked.issues.map((i) => i.id)).toEqual([2]);
    });

    it("status_report counts ready work", async () => {
        const report = (await call(client, "status_report")).json<{
            readyCount: number;
            percentComplete: number;
        }>();

        expect(report.readyCount).toBe(1);
        expect(report.percentComplete).toBe(0);
    });

    it("reports an unknown ref as a tool error rather than crashing", async () => {
        const result = await call(client, "get_issue", { ref: 9999 });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("9999");
    });

    it("reports an ambiguous ref with the candidates", async () => {
        await call(client, "create_issue", { title: "Build the other parser" });
        const result = await call(client, "get_issue", { ref: "parser" });

        expect(result.isError).toBe(true);
        expect(result.text).toContain("#1");
    });
});

describe("notes", () => {
    it("attributes a note to the connecting client by name", async () => {
        const root = project();
        const client = await connect(root);
        await call(client, "create_issue", { title: "Noted" });
        await call(client, "add_note", { ref: 1, body: "A decision." });

        const file = readdirSync(join(root, ".motte", "issues"))[0]!;
        const contents = readFileSync(join(root, ".motte", "issues", file), "utf8");

        // The client's own name from the handshake, not a hardcoded label.
        expect(contents).toContain("— claude-code (agent)");
        expect(contents).toContain("A decision.");
    });

    it("honours an explicit agent name", async () => {
        const root = project();
        const client = await connect(root, "atlas");
        await call(client, "create_issue", { title: "Noted" });
        await call(client, "add_note", { ref: 1, body: "Mine." });

        const file = readdirSync(join(root, ".motte", "issues"))[0]!;
        expect(readFileSync(join(root, ".motte", "issues", file), "utf8")).toContain(
            "— atlas (agent)"
        );
    });
});

describe("writing", () => {
    let client: Client;

    beforeEach(async () => {
        client = await connect(project());
        await call(client, "create_issue", { title: "Parent" });
    });

    it("set_state matches a state by prefix", async () => {
        const result = (await call(client, "set_state", { ref: 1, state: "in prog" })).json<{
            to: string;
        }>();
        expect(result.to).toBe("In Progress");
    });

    it("rejects an unknown state, listing what is configured", async () => {
        const result = await call(client, "set_state", { ref: 1, state: "Shipped" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("Todo");
    });

    it("update_issue touches only the fields given", async () => {
        await call(client, "update_issue", { ref: 1, plan: "1. Do it" });
        const issue = (await call(client, "get_issue", { ref: 1 })).json<{
            plan: string;
            title: string;
        }>();

        expect(issue.plan).toBe("1. Do it");
        expect(issue.title).toBe("Parent");
    });

    it("rejects a parent change that would create a cycle", async () => {
        await call(client, "create_issue", { title: "Child", parent: 1 });
        const result = await call(client, "set_parent", { ref: 1, parent: 2 });

        expect(result.isError).toBe(true);
        expect(result.text).toContain("cycle");
    });
});

describe("breakdown", () => {
    let client: Client;

    beforeEach(async () => {
        client = await connect(project());
        await call(client, "create_issue", { title: "Epic", labels: ["core"] });
    });

    it("creates every child under the parent in one call", async () => {
        const result = (
            await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "One" }, { title: "Two" }, { title: "Three" }]
            })
        ).json<{ created: { id: number; parent: number }[] }>();

        expect(result.created.map((c) => c.id)).toEqual([2, 3, 4]);
        expect(result.created.every((c) => c.parent === 1)).toBe(true);
    });

    it("wires dependencies between children by position", async () => {
        const result = (
            await call(client, "breakdown", {
                parent: 1,
                children: [
                    { title: "First" },
                    { title: "Second", blockedByIndex: [0] },
                    { title: "Third", blockedByIndex: [0, 1] }
                ]
            })
        ).json<{ created: { id: number; blockedBy: number[] }[]; ready: number[] }>();

        // Positions become real ids only after creation, which is why this is a second pass.
        expect(result.created[1]!.blockedBy).toEqual([2]);
        expect(result.created[2]!.blockedBy).toEqual([2, 3]);
        // Only the first child can be started.
        expect(result.ready).toEqual([2]);
    });

    it("gives children the parent's labels by default", async () => {
        const result = (
            await call(client, "breakdown", { parent: 1, children: [{ title: "One" }] })
        ).json<{ created: { labels: string[] }[] }>();

        expect(result.created[0]!.labels).toEqual(["core"]);
    });

    it("can be told not to inherit labels", async () => {
        const result = (
            await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "One" }],
                inheritLabels: false
            })
        ).json<{ created: { labels: string[] }[] }>();

        expect(result.created[0]!.labels).toEqual([]);
    });

    it("reports the parent's progress after the split", async () => {
        const result = (
            await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "One" }, { title: "Two" }]
            })
        ).json<{ progress: { total: number } }>();

        // The parent plus its two new children.
        expect(result.progress.total).toBe(3);
    });

    describe("validates the whole batch before writing anything", () => {
        const countIssues = async (): Promise<number> =>
            (await call(client, "list_issues")).json<{ count: number }>().count;

        it("rejects a child that depends on itself", async () => {
            const result = await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "A", blockedByIndex: [0] }]
            });

            expect(result.isError).toBe(true);
            expect(result.text).toContain("itself");
            expect(await countIssues()).toBe(1);
        });

        it("rejects a dependency on a later child, and says how to fix it", async () => {
            const result = await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "A", blockedByIndex: [1] }, { title: "B" }]
            });

            expect(result.isError).toBe(true);
            expect(result.text).toContain("comes later");
            // Nothing was created, so a rejected breakdown leaves no half-built subtree.
            expect(await countIssues()).toBe(1);
        });

        it("rejects an index past the end as out of range, not as ordering", async () => {
            const result = await call(client, "breakdown", {
                parent: 1,
                children: [{ title: "A" }, { title: "B", blockedByIndex: [9] }]
            });

            expect(result.isError).toBe(true);
            expect(result.text).toContain("only 2 children");
            expect(await countIssues()).toBe(1);
        });
    });
});

/**
 * The MCP surface is a hand-maintained duplicate of the CLI's `--json` shape, and that duplication is
 * what let `blockedBy` go missing from the CLI for several commits while this side had it. Both sides now
 * carry the same guard.
 *
 * Asserted through real tool calls rather than by exporting `issueJson`, so what is pinned is the response
 * an agent actually receives.
 */
describe("the issue shape agents receive", () => {
    let client: Client;

    beforeEach(async () => {
        const root = project();
        client = await connect(root);
        await call(client, "create_issue", { title: "Parent" });
        await call(client, "create_issue", { title: "Child", parent: 1, labels: ["core"] });
        await call(client, "set_blockers", { ref: 2, blockedBy: [1] });
    });

    /**
     * Every field of the issue model must reach the agent. Adding one to `FrontmatterSchema` and
     * forgetting this surface fails here rather than shipping a tool that silently lacks it.
     */
    it("represents every field of the issue model", async () => {
        const full = await call(client, "get_issue", { ref: 2 });
        const listed = await call(client, "list_issues");

        const emitted = Object.keys(full.json());
        const first = (listed.json<{ issues: Record<string, unknown>[] }>().issues ?? [])[0] ?? {};
        const listedKeys = Object.keys(first);

        for (const field of Object.keys(FrontmatterSchema.shape)) {
            expect(emitted, `\`${field}\` is missing from get_issue`).toContain(field);
            expect(listedKeys, `\`${field}\` is missing from list_issues`).toContain(field);
        }
    });

    it("pins the trimmed shape used by list_issues", async () => {
        const listed = await call(client, "list_issues");
        const first = listed.json<{ issues: Record<string, unknown>[] }>().issues[0]!;

        // `openBlockers` is derived and deliberately MCP-only: an agent choosing what to pick up needs to
        // know whether a blocker is still open, which `blockedBy` alone does not say. `unknownSections`
        // and the file path are deliberately absent — noise for an agent.
        expect(Object.keys(first).sort()).toEqual([
            "assignee",
            "blockedBy",
            "created",
            "id",
            "labels",
            "openBlockers",
            "parent",
            "state",
            "title",
            "updated"
        ]);
    });

    it("pins the full shape used by get_issue", async () => {
        const full = await call(client, "get_issue", { ref: 2 });

        expect(Object.keys(full.json()).sort()).toEqual([
            "assignee",
            "blockedBy",
            "children",
            "created",
            "description",
            "id",
            "labels",
            "notes",
            "openBlockers",
            "parent",
            "plan",
            "progress",
            "state",
            "title",
            "updated"
        ]);
    });

    /**
     * The two surfaces diverge on purpose, so the divergence is written down. If this list changes, it
     * should be because someone decided to change it.
     */
    it("differs from the CLI contract only in the documented ways", async () => {
        const full = Object.keys(await call(client, "get_issue", { ref: 2 }).then((r) => r.json()));
        const cli = Object.keys(
            issueJson({
                id: 1,
                title: "T",
                state: "Todo",
                created: "2026-07-30T00:00:00Z",
                updated: "2026-07-30T00:00:00Z",
                description: "",
                plan: "",
                notes: []
            })
        );

        // MCP adds derived context an agent needs; the CLI adds the file path a human might open.
        expect(full.filter((key) => !cli.includes(key)).sort()).toEqual([
            "children",
            "openBlockers",
            "progress"
        ]);
        expect(cli.filter((key) => !full.includes(key))).toEqual(["file"]);
    });
});
