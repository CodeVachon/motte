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
        static last: FakeEventSource | undefined;
        listeners = new Map<string, EventListener>();
        closed = false;

        constructor(readonly url: string) {
            FakeEventSource.last = this;
        }

        addEventListener(type: string, listener: EventListener): void {
            this.listeners.set(type, listener);
        }

        removeEventListener(type: string): void {
            this.listeners.delete(type);
        }

        close(): void {
            this.closed = true;
        }
    }

    it("listens for change events on the SSE endpoint", () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const onChange = vi.fn();

        const stop = subscribe(onChange);
        const source = FakeEventSource.last!;

        expect(source.url).toBe("/api/events");
        source.listeners.get("change")!(new Event("change"));
        expect(onChange).toHaveBeenCalledTimes(1);

        stop();
        expect(source.closed).toBe(true);
        expect(source.listeners.has("change")).toBe(false);
    });
});
