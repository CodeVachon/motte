/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    listeners = new Map<string, EventListener>();
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, listener);
    }
    removeEventListener(type: string): void {
        this.listeners.clear();
    }
    close(): void {
        this.closed = true;
    }
}

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
