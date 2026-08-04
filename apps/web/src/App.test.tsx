/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { config, issue, status } from "./testing/fixtures.js";

/**
 * The shell, with the network stubbed.
 *
 * Unlike the view tests this one goes through `useBacklog`, so it covers the wiring nothing else does: the
 * loading state, the error banner, and which view a URL selects.
 */

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;

    listeners = new Map<string, EventListener[]>();
    closed = false;
    /** Mirrors the real property, which `subscribe` reads to tell a retry from a dead stream. */
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

    /** Deliver an event the way the browser would. */
    emit(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
    }

    /** The stream drops. `fatal` models a response the browser will not retry, such as a 403. */
    drop(fatal = false): void {
        this.readyState = fatal ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
        this.emit("error");
    }
}

let statusLoads = 0;

function stubApi(options: { fail?: string } = {}): void {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", (url: string) => {
        if (options.fail !== undefined) {
            return Promise.resolve({
                ok: false,
                status: 500,
                statusText: "Server Error",
                json: () => Promise.resolve({ error: options.fail })
            });
        }

        const path = String(url);
        if (path === "/api/status") statusLoads += 1;
        const body =
            path === "/api/config"
                ? config()
                : path.startsWith("/api/issues")
                  ? { count: 1, issues: [issue({ id: 1, title: "Only issue" })] }
                  : status({ total: 1, percentComplete: 0, counted: 1, ready: [1] });

        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
}

beforeEach(() => {
    FakeEventSource.instances = [];
    statusLoads = 0;
    window.history.pushState(null, "", "/");
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("loading", () => {
    it("says it is loading before anything has arrived", async () => {
        stubApi();
        render(<App />);

        expect(screen.getByTestId("loading")).toBeDefined();

        // Let the pending load finish inside the test. Without this the fetch resolves after the test ends
        // and React warns about a state update outside act() — a warning that would then be background
        // noise hiding the next real one.
        await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
    });

    it("shows the project and its summary once loaded", async () => {
        stubApi();
        render(<App />);

        await waitFor(() =>
            expect(screen.getByTestId("project-name").textContent).toBe("Test Project")
        );
        expect(screen.getByTestId("summary").textContent).toContain("1 ready");
    });

    /** SSE is what makes a tab notice an agent's write, so the subscription has to actually happen. */
    it("subscribes to the event stream", async () => {
        stubApi();
        render(<App />);

        await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
        expect(FakeEventSource.instances[0]!.url).toBe("/api/events");
    });
});

describe("errors", () => {
    /** The other case the manual pass could not reach: the server's own words, on screen. */
    it("shows the server's message in a banner", async () => {
        stubApi({ fail: "the backlog is unreadable" });
        render(<App />);

        await waitFor(() =>
            expect(screen.getByTestId("error").textContent).toContain("the backlog is unreadable")
        );
        expect(screen.getByRole("alert")).toBeDefined();
    });
});

describe("routing", () => {
    it("shows the board at the root", async () => {
        stubApi();
        render(<App />);

        await waitFor(() => expect(screen.getByTestId("board")).toBeDefined());
    });

    it("shows the tree at /tree", async () => {
        window.history.pushState(null, "", "/tree");
        stubApi();
        render(<App />);

        await waitFor(() => expect(screen.getByTestId("tree")).toBeDefined());
    });

    it("shows one issue at /issues/:id", async () => {
        window.history.pushState(null, "", "/issues/1");
        stubApi();
        render(<App />);

        await waitFor(() => expect(screen.getByTestId("detail-1")).toBeDefined());
    });

    it("explains an unknown path instead of showing a blank page", async () => {
        window.history.pushState(null, "", "/nowhere");
        stubApi();
        render(<App />);

        await waitFor(() =>
            expect(screen.getByTestId("not-found").textContent).toContain("/nowhere")
        );
    });
});

/**
 * Losing the server.
 *
 * `EventSource` reconnects on its own and says nothing, so a tab left open on a stopped server kept
 * showing a board that looked current — one had logged 198 failed attempts. A stale board and a quiet one
 * are indistinguishable, which is the wrong failure for a tool whose only job is showing where work stands.
 */
describe("the change stream dropping", () => {
    async function loaded() {
        stubApi();
        render(<App />);
        await waitFor(() => expect(screen.getByTestId("board")).toBeDefined());
        return FakeEventSource.instances[0]!;
    }

    /**
     * Dispatched inside `act` because these are the browser's events, not the user's: without it React
     * warns on every state update they cause, and six such warnings would bury the next real one.
     */
    async function drop(source: FakeEventSource, fatal = false): Promise<void> {
        await act(async () => {
            source.drop(fatal);
        });
    }

    async function reopen(source: FakeEventSource): Promise<void> {
        await act(async () => {
            source.readyState = FakeEventSource.OPEN;
            source.emit("open");
        });
    }

    it("says nothing while the stream is healthy", async () => {
        const source = await loaded();
        await reopen(source);

        await waitFor(() => expect(screen.queryByTestId("disconnected")).toBeNull());
    });

    it("says so when the stream drops, without hiding the data it already has", async () => {
        const source = await loaded();
        await drop(source);

        await waitFor(() => expect(screen.getByTestId("disconnected")).toBeDefined());
        expect(screen.getByTestId("disconnected").textContent).toContain("motte serve");
        // The board stays: what is on screen is not wrong, it has only stopped being updated.
        expect(screen.getByTestId("board")).toBeDefined();
    });

    it("clears the notice and re-reads when the stream comes back", async () => {
        const source = await loaded();
        await drop(source);
        await waitFor(() => expect(screen.getByTestId("disconnected")).toBeDefined());

        const before = statusLoads;
        await reopen(source);

        await waitFor(() => expect(screen.queryByTestId("disconnected")).toBeNull());
        // Changes made during the outage produced events nobody received, so clearing the banner without
        // re-reading would leave the page quietly behind.
        await waitFor(() => expect(statusLoads).toBeGreaterThan(before));
    });

    /** A 403 from the Host check closes the stream for good; nothing recovers it without this. */
    it("opens a new stream when the browser gives up on the old one", async () => {
        // Real timers for the initial load — testing-library's waitFor polls on them — and fake ones only
        // for the wait this test is actually about.
        const source = await loaded();

        // Fake timers installed before the drop, not after: the re-open is scheduled by the drop, and a
        // timer already pending on the real clock is invisible to a fake one.
        vi.useFakeTimers();
        try {
            await drop(source, true);
            expect(source.closed).toBe(true);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(FakeEventSource.instances.length).toBe(2);
            expect(FakeEventSource.instances[1]!.url).toBe("/api/events");
        } finally {
            vi.useRealTimers();
        }
    });
});
