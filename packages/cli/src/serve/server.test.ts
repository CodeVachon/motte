import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { DEFAULT_STATES, loadConfigFrom, type Config } from "@motte/core";
import { startMotteServer, type RunningServer } from "./server.js";
import { directoryAssets } from "./assets.js";

/**
 * The HTTP layer, over a real socket on a real port.
 *
 * Only what the socket adds is tested here — body parsing, status plumbing, SSE framing, the Host check,
 * static files. Which body shapes are accepted and which status each failure maps to belongs to
 * `api.test.ts`, which drives the router directly and does not pay for a listener.
 */

let config: Config;
let running: RunningServer;
let previousAuthor: string | undefined;

function project(): Config {
    const root = mkdtempSync(join(tmpdir(), "motte-serve-"));
    const configPath = join(root, ".motte.config.json");

    writeFileSync(
        configPath,
        JSON.stringify({ name: "Served", issuesDir: ".motte/issues", states: DEFAULT_STATES }),
        "utf8"
    );

    const loaded = loadConfigFrom(configPath);
    mkdirSync(loaded.issuesPath, { recursive: true });
    return loaded;
}

beforeEach(async () => {
    // Pinned, because author resolution otherwise falls through to `git config user.name` — which is a
    // different name on every machine and unset on CI. Without this the actor assertions below would test
    // the environment rather than the server.
    previousAuthor = process.env.MOTTE_AUTHOR;
    process.env.MOTTE_AUTHOR = "Test User";

    config = project();
    running = await startMotteServer(config);
});

afterEach(async () => {
    await running.close();

    if (previousAuthor === undefined) delete process.env.MOTTE_AUTHOR;
    else process.env.MOTTE_AUTHOR = previousAuthor;
});

function get(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${running.url}${path}`, init);
}

async function post(path: string, body: unknown): Promise<Response> {
    return get(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body)
    });
}

describe("binding", () => {
    it("listens on loopback and reports the port it got", () => {
        expect(running.port).toBeGreaterThan(0);
        expect(running.url).toBe(`http://127.0.0.1:${running.port}`);
    });
});

describe("the JSON API over HTTP", () => {
    it("answers GET /api/status with JSON", async () => {
        const response = await get("/api/status");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/application\/json/);
        expect((await response.json()).total).toBe(0);
    });

    it("never lets a response be cached", async () => {
        expect((await get("/api/status")).headers.get("cache-control")).toBe("no-store");
    });

    it("round-trips a created issue", async () => {
        const created = await post("/api/issues", { title: "From the web", description: "x" });
        expect(created.status).toBe(201);
        expect((await created.json()).id).toBe(1);

        const fetched = await get("/api/issues/1");
        expect((await fetched.json()).title).toBe("From the web");
    });

    it("passes query parameters through to the router", async () => {
        await post("/api/issues", { title: "One", labels: ["core"] });
        await post("/api/issues", { title: "Two" });

        expect((await (await get("/api/issues?label=core")).json()).count).toBe(1);
    });

    it("applies a PATCH sent as JSON", async () => {
        await post("/api/issues", { title: "Movable" });

        const patched = await get("/api/issues/1", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: "Done" })
        });

        expect((await patched.json()).state).toBe("Done");
    });

    it("reports a body that is not JSON as a bad request, rather than crashing", async () => {
        const response = await post("/api/issues", "{ not json");

        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/not valid JSON/);
    });

    it("says what is wrong when a write arrives with no body at all", async () => {
        const response = await get("/api/issues", { method: "POST" });

        expect(response.status).toBe(400);
        // Not zod's "(root): expected object", which says nothing about what to do instead.
        expect((await response.json()).error).toMatch(/JSON object body is required/);
    });

    it("refuses a body larger than the limit", async () => {
        await running.close();
        running = await startMotteServer(config, { maxBodyBytes: 100 });

        const response = await post("/api/issues", { title: "x".repeat(500) });

        expect(response.status).toBe(413);
        expect((await response.json()).error).toMatch(/exceeds/);
    });

    it("404s an unknown API path", async () => {
        expect((await get("/api/nope")).status).toBe(404);
    });

    /**
     * A write from the browser is a person's, not an agent's, and it is recorded under the same name the CLI
     * would use. An earlier version named the actor "web", which made a state change and a note made in the
     * same click disagree about who did it — notes resolve their author separately.
     */
    it("attributes a write from the web to the same person the CLI would", async () => {
        await post("/api/issues", { title: "Noted" });
        await post("/api/issues/1/notes", { body: "Typed into the browser." });
        await get("/api/issues/1", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: "Done" })
        });

        const issue = await (await get("/api/issues/1")).json();
        const note = issue.notes.at(-1);

        expect(note.author.type).toBe("user");
        expect(note.author.name).toBe("Test User");

        // The event log has to agree with the note about who did it.
        const events = readFileSync(
            join(
                config.root,
                ".motte",
                "events",
                readdirSync(join(config.root, ".motte", "events"))[0]!
            ),
            "utf8"
        )
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { by: string; as: string });

        expect(new Set(events.map((event) => event.by))).toEqual(new Set(["Test User"]));
        expect(new Set(events.map((event) => event.as))).toEqual(new Set(["user"]));
    });

    /**
     * A change written to disk between two requests must be visible to the second. The store caches parses
     * by mtime, so this is really a check that the server does not hold one store for its lifetime.
     */
    it("sees a change made on disk behind its back", async () => {
        await post("/api/issues", { title: "Original" });

        const file = join(config.issuesPath, "0001-original.md");
        const { readFileSync, writeFileSync: write } = await import("node:fs");
        write(file, readFileSync(file, "utf8").replace("state: Todo", "state: Done"), "utf8");

        expect((await (await get("/api/issues/1")).json()).state).toBe("Done");
    });
});

/**
 * `fetch` silently drops a `host` header — it is forbidden by the fetch spec — so the first version of
 * these tests proved nothing and the 200 they saw was the server correctly answering a real localhost
 * request. `http.request` sets it honestly.
 */
function getWithHost(
    path: string,
    host: string,
    method = "GET"
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const request = httpRequest(
            { host: "127.0.0.1", port: running.port, path, method, headers: { host } },
            (response) => {
                let body = "";
                response.on("data", (chunk) => (body += String(chunk)));
                response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
            }
        );
        request.on("error", reject);
        request.end();
    });
}

describe("the Host check", () => {
    /**
     * A no-auth server on loopback is still reachable through DNS rebinding: a page on the internet can
     * point its own hostname at 127.0.0.1 and then read this API from the user's browser. The Host header
     * is what distinguishes that from a genuine local request.
     */
    it("refuses a request claiming a foreign Host", async () => {
        const response = await getWithHost("/api/status", "evil.example.com");

        expect(response.status).toBe(403);
        expect(JSON.parse(response.body).error).toMatch(/localhost/);
    });

    it("accepts localhost and 127.0.0.1, with or without a port", async () => {
        for (const host of [
            "localhost",
            "127.0.0.1",
            `localhost:${running.port}`,
            `127.0.0.1:${running.port}`
        ]) {
            expect((await getWithHost("/api/status", host)).status).toBe(200);
        }
    });

    /**
     * A local proxy forwards the port the user typed, not the one this server listens on — `bun run
     * dev:web` proxies `/api` from Vite on 5173 to a serve on 4321. Requiring the ports to match blocked
     * that while stopping no attack, since a rebinding attempt is caught by the name.
     */
    it("accepts a loopback name carrying somebody else's port", async () => {
        expect((await getWithHost("/api/status", "localhost:5173")).status).toBe(200);
    });

    it("refuses a hostname that merely ends in localhost", async () => {
        expect((await getWithHost("/api/status", "notlocalhost")).status).toBe(403);
        expect((await getWithHost("/api/status", "localhost.evil.com")).status).toBe(403);
    });
});

describe("server-sent events", () => {
    it("opens a stream, says hello, and counts the subscriber", async () => {
        const response = await get("/api/events");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");

        const reader = response.body!.getReader();
        const first = new TextDecoder().decode((await reader.read()).value);

        expect(first).toContain("event: hello");
        expect(running.subscribers()).toBe(1);

        await reader.cancel();
    });

    /**
     * The only test here that waits on the operating system to notice a file write. macOS delivers directory
     * events anywhere from immediately to not within several seconds under load, which is why `watch.test.ts`
     * injects a fake watcher for everything except one integration case. This is the equivalent case for the
     * server, so it retries for the same reason.
     */
    it("pushes a change when the backlog is written to", { retry: 3 }, async () => {
        const response = await get("/api/events");
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        // Drain the hello so what follows is the change itself.
        await reader.read();

        // Written directly rather than through the API, since that is the case the watcher exists for: an
        // agent or the CLI changing the backlog while a tab is open.
        writeFileSync(
            join(config.issuesPath, "0001-from-disk.md"),
            "---\nid: 1\ntitle: From disk\nstate: Todo\ncreated: 2026-07-30T00:00:00Z\nupdated: 2026-07-30T00:00:00Z\n---\n\n## Description\n\nx\n",
            "utf8"
        );

        let text = "";
        const deadline = Date.now() + 15_000;
        while (!text.includes("event: change") && Date.now() < deadline) {
            const chunk = await reader.read();
            if (chunk.done) break;
            text += decoder.decode(chunk.value);
        }

        expect(text).toContain("event: change");
        await reader.cancel();
    });

    it("stops counting a subscriber once it disconnects", async () => {
        const response = await get("/api/events");
        const reader = response.body!.getReader();
        await reader.read();
        expect(running.subscribers()).toBe(1);

        await reader.cancel();

        const deadline = Date.now() + 5_000;
        while (running.subscribers() !== 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        expect(running.subscribers()).toBe(0);
    });

    it("405s a method other than GET", async () => {
        expect((await get("/api/events", { method: "POST" })).status).toBe(405);
    });
});

describe("static assets", () => {
    it("serves a placeholder page explaining that no interface is embedded", async () => {
        const response = await get("/");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/text\/html/);
        expect(await response.text()).toContain("not built into this binary");
    });

    it("serves files from a directory when given one", async () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-assets-"));
        writeFileSync(join(dir, "index.html"), "<h1>real</h1>", "utf8");
        // A real Vite filename: `name-HASH.ext`, with a base64url hash rather than hex.
        writeFileSync(join(dir, "index-BMkVQf6L.js"), "console.log(1)", "utf8");

        await running.close();
        running = await startMotteServer(config, { assets: directoryAssets(dir) });

        expect(await (await get("/")).text()).toBe("<h1>real</h1>");

        const script = await get("/index-BMkVQf6L.js");
        expect(script.headers.get("content-type")).toMatch(/javascript/);
        // A hashed filename can never change under a given name, so it is safe to cache hard.
        expect(script.headers.get("cache-control")).toMatch(/immutable/);

        // The entry document must never be cached, or a rebuild is invisible until a hard reload.
        expect((await get("/")).headers.get("cache-control")).toBe("no-store");
    });

    it("falls back to the entry document for a client-side route", async () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-assets-"));
        writeFileSync(join(dir, "index.html"), "<h1>spa</h1>", "utf8");

        await running.close();
        running = await startMotteServer(config, { assets: directoryAssets(dir) });

        // /issues/12 is the SPA's route, not a file on disk.
        expect(await (await get("/issues/12")).text()).toBe("<h1>spa</h1>");
    });

    /** A localhost server is still reachable by anything running on the machine. */
    it("refuses to escape the asset root", async () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-assets-"));
        writeFileSync(join(dir, "index.html"), "<h1>spa</h1>", "utf8");
        writeFileSync(join(dir, "..", "secret.txt"), "do not serve me", "utf8");

        await running.close();
        running = await startMotteServer(config, { assets: directoryAssets(dir) });

        // Falls back to index.html rather than reading the file above the root.
        expect(await (await get("/../secret.txt")).text()).not.toContain("do not serve me");
        expect(await (await get("/%2e%2e/secret.txt")).text()).not.toContain("do not serve me");
    });

    it("405s a write to a non-API path", async () => {
        expect((await post("/", { anything: true })).status).toBe(405);
    });
});
