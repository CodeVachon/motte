/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Detail } from "./Detail.js";
import { backlog, issue } from "../testing/fixtures.js";

afterEach(cleanup);

/** Capture the requests the client sends, so a test can pin the body and not just the fact of a call. */
function captureFetch(response: () => unknown = () => issue()) {
    const requests: { url: string; method: string; body: unknown }[] = [];

    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
        requests.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: JSON.parse(String(init?.body ?? "null"))
        });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(response()) });
    });

    return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe("what it shows", () => {
    it("distinguishes an issue that is loading from one that does not exist", () => {
        const { unmount } = render(<Detail backlog={backlog({ loading: true })} id={9} />);
        expect(screen.getByTestId("issue-missing").textContent).toContain("Loading");
        unmount();

        render(<Detail backlog={backlog({ loading: false })} id={9} />);
        expect(screen.getByTestId("issue-missing").textContent).toContain("No issue #9");
    });

    it("lists children and blockers, marking the blockers still open", () => {
        render(
            <Detail
                backlog={backlog({
                    issues: [
                        issue({ id: 1, title: "The issue", blockedBy: [2, 3], openBlockers: [2] }),
                        issue({ id: 2, title: "Still open", state: "Todo" }),
                        issue({ id: 3, title: "Finished", state: "Done" }),
                        issue({ id: 4, title: "A child", parent: 1 })
                    ]
                })}
                id={1}
            />
        );

        const detail = screen.getByTestId("detail-1");
        expect(detail.textContent).toContain("Blocked by");
        expect(detail.textContent).toContain("Still open");
        expect(detail.textContent).toContain("Children");
        expect(detail.textContent).toContain("A child");
    });

    it("offers every configured state, and every other issue as a possible parent", () => {
        render(
            <Detail
                backlog={backlog({ issues: [issue({ id: 1 }), issue({ id: 2, title: "Other" })] })}
                id={1}
            />
        );

        const states = [...screen.getByTestId("edit-state").querySelectorAll("option")].map(
            (option) => option.textContent
        );
        expect(states).toEqual(["Todo", "In Progress", "Done"]);

        const parents = [...screen.getByTestId("edit-parent").querySelectorAll("option")].map(
            (option) => option.textContent
        );
        // "none", and the other issue — never itself, which would be an immediate cycle.
        expect(parents).toEqual(["— none —", "#2 Other"]);
    });
});

describe("editing", () => {
    it("saves a changed field on blur", async () => {
        const requests = captureFetch();
        const state = backlog({ issues: [issue({ id: 1, title: "Before" })] });
        render(<Detail backlog={state} id={1} />);

        const title = screen.getByTestId("edit-title");
        fireEvent.change(title, { target: { value: "After" } });
        fireEvent.blur(title);

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect(requests).toEqual([
            { url: "/api/issues/1", method: "PATCH", body: { title: "After" } }
        ]);
    });

    /** Saving an unchanged field would bump `updated` and record an event for nothing. */
    it("does not save a field that was not changed", async () => {
        const state = backlog({ issues: [issue({ id: 1, title: "Before" })] });
        render(<Detail backlog={state} id={1} />);

        fireEvent.blur(screen.getByTestId("edit-title"));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.calls).toHaveLength(0);
    });

    it("clears the assignee with null rather than an empty string", async () => {
        const requests = captureFetch();
        const state = backlog({ issues: [issue({ id: 1, assignee: "atlas" })] });
        render(<Detail backlog={state} id={1} />);

        const assignee = screen.getByTestId("edit-assignee");
        fireEvent.change(assignee, { target: { value: "   " } });
        fireEvent.blur(assignee);

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect(requests[0]!.body).toEqual({ assignee: null });
    });

    it("saves a state change as soon as it is picked", async () => {
        const requests = captureFetch();
        const state = backlog({ issues: [issue({ id: 1 })] });
        render(<Detail backlog={state} id={1} />);

        fireEvent.change(screen.getByTestId("edit-state"), { target: { value: "Done" } });

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect(requests[0]!.body).toEqual({ state: "Done" });
    });

    /**
     * The case the manual pass could not easily reach. A refused write must leave the user's text in the
     * field: throwing it away would lose work over a rule they can still act on.
     */
    it("keeps what the user typed when the server refuses the write", async () => {
        captureFetch();
        const state = backlog({
            issues: [issue({ id: 1, title: "Before" })],
            refuse: "that would create a cycle"
        });
        render(<Detail backlog={state} id={1} />);

        const title = screen.getByTestId("edit-title");
        fireEvent.change(title, { target: { value: "Rejected edit" } });
        fireEvent.blur(title);

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect((title as HTMLInputElement).value).toBe("Rejected edit");
    });

    /** A change from the CLI or an agent should win over a field the user is not editing. */
    it("takes an incoming change into an untouched field", () => {
        const { rerender } = render(
            <Detail backlog={backlog({ issues: [issue({ id: 1, title: "First" })] })} id={1} />
        );
        expect((screen.getByTestId("edit-title") as HTMLInputElement).value).toBe("First");

        rerender(
            <Detail
                backlog={backlog({ issues: [issue({ id: 1, title: "Changed elsewhere" })] })}
                id={1}
            />
        );
        expect((screen.getByTestId("edit-title") as HTMLInputElement).value).toBe(
            "Changed elsewhere"
        );
    });
});

describe("notes", () => {
    it("appends a note and clears the composer", async () => {
        const requests = captureFetch();
        const state = backlog({ issues: [issue({ id: 1 })] });
        render(<Detail backlog={state} id={1} />);

        const body = screen.getByTestId("note-body");
        fireEvent.change(body, { target: { value: "A decision." } });
        fireEvent.click(screen.getByTestId("add-note"));

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect(requests).toEqual([
            { url: "/api/issues/1/notes", method: "POST", body: { body: "A decision." } }
        ]);
        await waitFor(() => expect((body as HTMLTextAreaElement).value).toBe(""));
    });

    /** A refused note must not vanish — it is the one thing here the user cannot retrieve. */
    it("keeps the draft when the note is refused", async () => {
        captureFetch();
        const state = backlog({ issues: [issue({ id: 1 })], refuse: "no" });
        render(<Detail backlog={state} id={1} />);

        const body = screen.getByTestId("note-body");
        fireEvent.change(body, { target: { value: "Do not lose me." } });
        fireEvent.click(screen.getByTestId("add-note"));

        await waitFor(() => expect(state.calls).toHaveLength(1));
        expect((body as HTMLTextAreaElement).value).toBe("Do not lose me.");
    });

    it("will not submit an empty note", () => {
        const state = backlog({ issues: [issue({ id: 1 })] });
        render(<Detail backlog={state} id={1} />);

        expect((screen.getByTestId("add-note") as HTMLButtonElement).disabled).toBe(true);
    });

    it("renders each note with its author and whether they were an agent", () => {
        render(
            <Detail
                backlog={backlog({
                    issues: [
                        issue({
                            id: 1,
                            notes: [
                                {
                                    at: "2026-08-04T10:00:00Z",
                                    author: { name: "claude", type: "agent" },
                                    body: "From an agent."
                                }
                            ]
                        })
                    ]
                })}
                id={1}
            />
        );

        const notes = screen.getByTestId("notes").textContent ?? "";
        expect(notes).toContain("claude");
        expect(notes).toContain("agent");
        expect(notes).toContain("From an agent.");
    });
});
