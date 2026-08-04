import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { IssueStore, watchBacklog, type Config } from "@motte/core";
import { handleApi, type ApiContext } from "./api.js";
import { createBroadcaster, type Broadcaster } from "./sse.js";
import { placeholderAssets, type AssetLookup } from "./assets.js";

/**
 * The HTTP layer: parse, dispatch, respond.
 *
 * `node:http` rather than `Bun.serve`, which the original plan called for. Bun implements node:http, so the
 * compiled binary behaves identically, and it means everything in here can be driven in-process against a
 * real socket — where `Bun.serve` would be undefined under vitest, which runs on Node. #0033 has the
 * reasoning; the short version is that this project has already had to undo that choice twice elsewhere.
 *
 * Deliberately thin. Routing decisions and status codes live in `api.ts`, which is tested without sockets.
 */

export interface ServeOptions {
    port?: number;
    /**
     * Loopback only, and not configurable.
     *
     * There is no authentication — it is a local tool reading a local directory — so binding anywhere else
     * would expose a full read/write API to the network.
     */
    host?: "127.0.0.1";
    assets?: AssetLookup;
    /** Bodies larger than this are refused. */
    maxBodyBytes?: number;
}

export interface RunningServer {
    server: Server;
    port: number;
    url: string;
    /** Open SSE subscribers, exposed for tests and for the eventual `motte watch`. */
    subscribers: () => number;
    close: () => Promise<void>;
}

const MAX_BODY = 1_000_000;

/**
 * Hosts a request may claim to be for.
 *
 * A no-auth server bound to loopback is still reachable through DNS rebinding: a page on the internet can
 * resolve its own hostname to 127.0.0.1 and then read this API from the user's browser. Checking that the
 * Host header is a loopback name is what stops that, and it costs nothing.
 *
 * The name is checked; the port is not. A browser always sends the port it connected to, so a rebinding
 * attempt fails on the name regardless — while a local proxy legitimately forwards the port the user
 * typed, which is a different number. Requiring a match only ever broke the proxy: `bun run dev:web`
 * forwards `/api` from Vite on 5173 to a `motte serve` on 4321, and every request came back 403.
 */
function hostAllowed(host: string | undefined): boolean {
    if (host === undefined) return false;

    const name = host
        .replace(/:\d+$/, "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();

    return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function send(response: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body, null, 2);
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(json),
        // Nothing here should ever be cached; the whole point is that it changes under you.
        "cache-control": "no-store"
    });
    response.end(json);
}

function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                // Deliberately not `request.destroy()`. Destroying here tore down the socket before the
                // 413 could be written, so the client saw a connection error rather than a status — which
                // a test caught. Draining instead lets the response be delivered.
                request.resume();
                reject(new Error(`request body exceeds ${limit} bytes`));
                return;
            }
            chunks.push(chunk);
        });

        request.on("end", () => {
            resolve(chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8"));
        });
        request.on("error", reject);
    });
}

/** Open an SSE stream and attach it as a subscriber. */
function serveEvents(
    broadcaster: Broadcaster,
    request: IncomingMessage,
    response: ServerResponse
): void {
    if (request.method !== "GET") {
        send(response, 405, { error: `${request.method} is not allowed on /api/events` });
        return;
    }

    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        // Without this a proxy may buffer the stream and nothing arrives until it closes.
        "x-accel-buffering": "no"
    });

    broadcaster.subscribe(response);
    // Say hello immediately, so the client knows the stream is live rather than merely open.
    response.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
}

/** Read and parse a JSON body, answering the request itself if it cannot. */
async function bodyOf(
    request: IncomingMessage,
    response: ServerResponse,
    limit: number
): Promise<{ ok: true; body: unknown } | { ok: false }> {
    if (request.method === "GET" || request.method === "HEAD") return { ok: true, body: undefined };

    let raw: string | undefined;
    try {
        raw = await readBody(request, limit);
    } catch (thrown) {
        send(response, 413, { error: thrown instanceof Error ? thrown.message : String(thrown) });
        return { ok: false };
    }

    if (raw === undefined || raw.trim() === "") return { ok: true, body: undefined };

    try {
        return { ok: true, body: JSON.parse(raw) };
    } catch {
        send(response, 400, { error: "request body is not valid JSON" });
        return { ok: false };
    }
}

function serveAsset(lookup: AssetLookup, pathname: string, response: ServerResponse): void {
    const asset = lookup(pathname);

    if (asset !== undefined) {
        response.writeHead(200, {
            "content-type": asset.type,
            "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-store"
        });
        response.end(asset.body);
        return;
    }

    // Anything unrecognised falls back to the entry document, because the SPA owns its own routing and a
    // deep link like /issues/12 is a client route rather than a file. Genuinely missing files under a
    // recognisable asset path would be better as a 404, which #0034 can refine once real assets exist.
    const index = lookup("/index.html");
    if (index !== undefined) {
        response.writeHead(200, { "content-type": index.type, "cache-control": "no-store" });
        response.end(index.body);
        return;
    }

    send(response, 404, { error: `no such path: ${pathname}` });
}

/**
 * Build the server. Nothing is listening until `listen` is called.
 *
 * A fresh `IssueStore` per request rather than one long-lived instance: the store caches parses by mtime,
 * so re-reading is cheap, and a request must never serve state from before an agent's last write.
 */
function createMotteServer(config: Config, options: ServeOptions = {}): Server {
    const assets = options.assets ?? placeholderAssets();
    const limit = options.maxBodyBytes ?? MAX_BODY;
    const broadcaster = createBroadcaster();

    const context = (): ApiContext => ({
        config,
        /**
         * No explicit author, so the store resolves one the same way the CLI does: the git user.
         *
         * An earlier version passed `{ name: "web" }`, which made the log disagree with itself — a state
         * change from the browser was recorded as `web` while a note typed in the same page was recorded
         * under the git user, because notes resolve their author separately. The log exists to say who did
         * something and whether they were a person or an agent, and the answer for the web UI is the person
         * sitting at the machine. The CLI does not label itself `cli` either.
         */
        store: new IssueStore(config)
    });

    const server = createServer((request, response) => {
        void handle(request, response).catch((thrown: unknown) => {
            // Last resort. An exception escaping here would leave the browser waiting on a socket that
            // never answers, which is harder to diagnose than any error message.
            if (!response.headersSent) {
                send(response, 500, {
                    error: thrown instanceof Error ? thrown.message : String(thrown)
                });
            } else {
                response.end();
            }
        });
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;

        if (!hostAllowed(request.headers.host)) {
            send(response, 403, {
                error: "motte serve only answers requests addressed to localhost"
            });
            return;
        }

        const url = new URL(request.url ?? "/", "http://localhost");
        const pathname = url.pathname;

        if (pathname === "/api/events") {
            serveEvents(broadcaster, request, response);
            return;
        }

        if (pathname === "/api" || pathname.startsWith("/api/")) {
            const parsed = await bodyOf(request, response, limit);
            if (!parsed.ok) return;

            const result = handleApi(context(), {
                method: request.method ?? "GET",
                path: pathname.slice("/api".length) || "/",
                query: url.searchParams,
                ...(parsed.body === undefined ? {} : { body: parsed.body })
            });

            send(response, result.status, result.body);
            return;
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
            send(response, 405, { error: `${request.method} is not allowed on ${pathname}` });
            return;
        }

        serveAsset(assets, pathname, response);
    }

    // Push a change to every open tab. The watcher is coarse, so this says "re-read", not what changed.
    const stopWatching = watchBacklog(config, (change) => broadcaster.send("change", change));

    server.on("close", () => {
        stopWatching();
        broadcaster.close();
    });

    // Reachable from `start` for the subscriber count, without exporting the broadcaster itself.
    attached.set(server, broadcaster);

    return server;
}

const attached = new WeakMap<Server, Broadcaster>();

/** Start listening. Resolves once the port is known, which for port 0 is only after binding. */
export function startMotteServer(
    config: Config,
    options: ServeOptions = {}
): Promise<RunningServer> {
    const server = createMotteServer(config, options);

    return new Promise((resolve, reject) => {
        server.once("error", reject);

        server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;

            resolve({
                server,
                port,
                url: `http://127.0.0.1:${port}`,
                subscribers: () => attached.get(server)?.size ?? 0,
                close: () =>
                    new Promise<void>((done) => {
                        // Close the streams first: an open SSE response keeps the server from closing.
                        attached.get(server)?.close();
                        server.close(() => done());
                        // SSE aside, a keep-alive connection can also hold it open.
                        server.closeIdleConnections?.();
                    })
            });
        });
    });
}
