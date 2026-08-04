import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, subscribe } from "./api.js";

/**
 * The API client, against a stubbed `fetch`.
 *
 * What is worth testing here is the part that is easy to get quietly wrong: the URLs built from arguments,
 * and whether a failure arrives as something a caller can act on. The server's behaviour is already covered
 * by `serve/api.test.ts` and `serve/server.test.ts`; repeating it here would only test the stub.
 */

interface Call {
    url: string;
    init: RequestInit | undefined;
}

function stubFetch(response: { status?: number; body?: unknown; reject?: Error }): Call[] {
    const calls: Call[] = [];

    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });

        if (response.reject) return Promise.reject(response.reject);

        const status = response.status ?? 200;
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 404 ? "Not Found" : "OK",
            json: () => Promise.resolve(response.body ?? {})
        });
    });

    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the URLs it builds", () => {
    it("prefixes every path with /api, so the same build works behind the dev proxy and in production", async () => {
        const calls = stubFetch({ body: { name: "x" } });
        await api.config();

        expect(calls[0]!.url).toBe("/api/config");
    });

    it("omits an empty query rather than leaving a trailing question mark", async () => {
        const calls = stubFetch({ body: { count: 0, issues: [] } });
        await api.issues();

        expect(calls[0]!.url).toBe("/api/issues");
    });

    it("encodes filters into the query", async () => {
        const calls = stubFetch({ body: { count: 0, issues: [] } });
        await api.issues({ state: "In Progress", label: "core" });

        expect(calls[0]!.url).toBe("/api/issues?state=In+Progress&label=core");
    });

    it("passes a tree ref through, and omits it when absent", async () => {
        const calls = stubFetch({ body: { roots: [], problems: [] } });
        await api.tree(7);
        await api.tree();

        expect(calls[0]!.url).toBe("/api/tree?ref=7");
        expect(calls[1]!.url).toBe("/api/tree");
    });
});

describe("the requests it sends", () => {
    it("sends a create as a POST with a JSON content type", async () => {
        const calls = stubFetch({ status: 201, body: { id: 1 } });
        await api.create({ title: "New" });

        expect(calls[0]!.init?.method).toBe("POST");
        expect(calls[0]!.init?.body).toBe('{"title":"New"}');
        expect((calls[0]!.init?.headers as Record<string, string>)["content-type"]).toBe(
            "application/json"
        );
    });

    it("sends an update as a PATCH", async () => {
        const calls = stubFetch({ body: { id: 1 } });
        await api.update(1, { state: "Done" });

        expect(calls[0]!.url).toBe("/api/issues/1");
        expect(calls[0]!.init?.method).toBe("PATCH");
    });

    /** `null` is how the UI clears a field, and it has to survive serialisation to mean that. */
    it("keeps a null in the body rather than dropping the key", async () => {
        const calls = stubFetch({ body: { id: 1 } });
        await api.update(1, { assignee: null });

        expect(calls[0]!.init?.body).toBe('{"assignee":null}');
    });

    it("wraps a note in the body field the server expects", async () => {
        const calls = stubFetch({ status: 201, body: { id: 1 } });
        await api.addNote(1, "A decision.");

        expect(calls[0]!.url).toBe("/api/issues/1/notes");
        expect(calls[0]!.init?.body).toBe('{"body":"A decision."}');
    });

    it("sets no content type on a request with no body", async () => {
        const calls = stubFetch({ body: {} });
        await api.status();

        expect((calls[0]!.init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    });
});

describe("how failures arrive", () => {
    it("raises the server's own message, with the status attached", async () => {
        stubFetch({ status: 404, body: { error: 'no issue matching "99"' } });

        await expect(api.issue(99)).rejects.toMatchObject({
            name: "ApiError",
            status: 404,
            message: 'no issue matching "99"'
        });
    });

    /** A proxy or a crash can answer with something that is not the API's error shape. */
    it("falls back to the status line when the body is not the API's error shape", async () => {
        stubFetch({ status: 404, body: undefined });

        await expect(api.issue(99)).rejects.toThrow("404 Not Found");
    });

    /**
     * The common case is the server having been stopped with Ctrl-C in the terminal it was started from,
     * and "failed to fetch" on its own does not suggest that.
     */
    it("says the server is unreachable rather than passing on a bare network error", async () => {
        stubFetch({ reject: new Error("Failed to fetch") });

        const thrown = await api.status().catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect((thrown as ApiError).status).toBe(0);
        expect((thrown as ApiError).message).toMatch(/could not reach motte serve/);
    });
});

describe("subscribe", () => {
    class FakeEventSource {
        static instances: FakeEventSource[] = [];
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;

        listeners = new Map<string, EventListener[]>();
        closed = false;
        readyState = FakeEventSource.CONNECTING;

        constructor(readonly url: string) {
            FakeEventSource.instances.push(this);
        }

        addEventListener(type: string, listener: EventListener): void {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        removeEventListener(type: string, listener: EventListener): void {
            this.listeners.set(
                type,
                (this.listeners.get(type) ?? []).filter((l) => l !== listener)
            );
        }

        close(): void {
            this.closed = true;
            this.readyState = FakeEventSource.CLOSED;
        }

        emit(type: string): void {
            for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
        }
    }

    function start() {
        vi.stubGlobal("EventSource", FakeEventSource);
        FakeEventSource.instances = [];

        const change = vi.fn();
        const connection = vi.fn();
        const stop = subscribe({ change, connection });

        return { change, connection, stop, source: () => FakeEventSource.instances.at(-1)! };
    }

    it("listens for change events on the SSE endpoint", () => {
        const { change, stop, source } = start();

        expect(source().url).toBe("/api/events");
        source().emit("change");
        expect(change).toHaveBeenCalledTimes(1);

        stop();
        expect(source().closed).toBe(true);
        source().emit("change");
        expect(change).toHaveBeenCalledTimes(1);
    });

    /**
     * The state is reported because reconnecting silently is the failure this exists to fix: a tab left on a
     * stopped server showed a board that looked current while logging 198 failed attempts.
     */
    it("reports connecting, then live, then lost", () => {
        const { connection, source, stop } = start();

        expect(connection).toHaveBeenLastCalledWith("connecting");

        source().readyState = FakeEventSource.OPEN;
        source().emit("open");
        expect(connection).toHaveBeenLastCalledWith("live");

        source().emit("error");
        expect(connection).toHaveBeenLastCalledWith("lost");

        stop();
    });

    /** A retry in progress is the browser doing its job; a closed stream is nobody doing anything. */
    it("leaves the browser's own retry alone", () => {
        const { source, stop } = start();

        source().emit("error");

        expect(FakeEventSource.instances.length).toBe(1);
        expect(source().closed).toBe(false);
        stop();
    });

    it("opens a fresh stream when the browser has given up", async () => {
        vi.useFakeTimers();
        try {
            const { source, stop } = start();
            const first = source();

            first.readyState = FakeEventSource.CLOSED;
            first.emit("error");
            expect(first.closed).toBe(true);

            await vi.advanceTimersByTimeAsync(3000);

            expect(FakeEventSource.instances.length).toBe(2);
            expect(source().url).toBe("/api/events");
            stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not re-open after the caller has unsubscribed", async () => {
        vi.useFakeTimers();
        try {
            const { source, stop } = start();

            source().readyState = FakeEventSource.CLOSED;
            source().emit("error");
            stop();

            await vi.advanceTimersByTimeAsync(10_000);

            // A tab that navigated away must not keep dialling the server it just left.
            expect(FakeEventSource.instances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
