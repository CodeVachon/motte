/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Board } from "./Board.js";
import { backlog, config, issue } from "../testing/fixtures.js";

/**
 * The board, rendered into jsdom.
 *
 * jsdom per file through the docblock above rather than globally, because everything in `packages/` is a
 * Node program and giving it a fake DOM would be misleading.
 *
 * Drag and drop is native HTML5, so it is driven here by firing the events the browser would: dragStart on a
 * card, then drop on a column. That is not the same as a real pointer gesture — Playwright covers that — but
 * it is exactly the contract the handlers are written against.
 */

afterEach(cleanup);

describe("columns", () => {
    it("makes a column for every configured state, in configured order", () => {
        render(<Board backlog={backlog()} />);

        const headings = screen
            .getAllByRole("heading", { level: 2 })
            .map((node) => node.textContent);
        expect(headings).toEqual(["Todo", "In Progress", "Done"]);
    });

    /**
     * States come from the project's config, so a project with states this UI has never heard of still gets
     * columns for them. Hardcoding Todo/In Progress/Done would have been easy and wrong.
     */
    it("renders states it has never seen before", () => {
        render(
            <Board
                backlog={backlog({
                    config: config({
                        states: [
                            { name: "Icebox", category: "unstarted" },
                            { name: "Review", category: "started" },
                            { name: "Shipped", category: "completed" },
                            { name: "Dropped", category: "cancelled" }
                        ]
                    }),
                    issues: [issue({ id: 1, state: "Review" })]
                })}
            />
        );

        expect(screen.getByRole("heading", { name: "Review" })).toBeDefined();
        expect(screen.getByTestId("column-Review").textContent).toContain("An issue");
    });

    it("puts each issue in the column for its state, and counts them", () => {
        render(
            <Board
                backlog={backlog({
                    issues: [
                        issue({ id: 1, state: "Todo", title: "First" }),
                        issue({ id: 2, state: "Todo", title: "Second" }),
                        issue({ id: 3, state: "Done", title: "Third" })
                    ]
                })}
            />
        );

        expect(screen.getByTestId("column-Todo").textContent).toContain("First");
        expect(screen.getByTestId("column-Todo").textContent).toContain("Second");
        expect(screen.getByTestId("column-Todo").textContent).toContain("2");
        expect(screen.getByTestId("column-Done").textContent).toContain("Third");
    });

    it("says so when a column is empty rather than leaving a blank space", () => {
        render(<Board backlog={backlog()} />);

        expect(screen.getAllByText("nothing here")).toHaveLength(3);
    });
});

describe("cards", () => {
    it("shows the padded id and the title", () => {
        render(<Board backlog={backlog({ issues: [issue({ id: 7, title: "Padded" })] })} />);

        expect(screen.getByTestId("card-7").textContent).toContain("#0007");
        expect(screen.getByTestId("card-7").textContent).toContain("Padded");
    });

    /** The badge is what tells a reader they cannot start something, so it keys on openBlockers. */
    it("marks an issue whose blockers are still open", () => {
        render(
            <Board
                backlog={backlog({
                    issues: [issue({ id: 2, blockedBy: [1], openBlockers: [1] })]
                })}
            />
        );

        expect(screen.getByTestId("blocked-2")).toBeDefined();
    });

    it("does not mark an issue whose blockers are all settled", () => {
        render(
            <Board
                backlog={backlog({ issues: [issue({ id: 2, blockedBy: [1], openBlockers: [] })] })}
            />
        );

        expect(screen.queryByTestId("blocked-2")).toBeNull();
    });

    it("shows the assignee and labels when there are any", () => {
        render(
            <Board
                backlog={backlog({
                    issues: [issue({ id: 1, assignee: "atlas", labels: ["core", "cli"] })]
                })}
            />
        );

        const card = screen.getByTestId("card-1");
        expect(card.textContent).toContain("atlas");
        expect(card.textContent).toContain("core");
        expect(card.textContent).toContain("cli");
    });
});

describe("drag to change state", () => {
    /** A minimal stand-in for the browser's DataTransfer, which jsdom does not provide. */
    function dataTransfer(): DataTransfer {
        const store = new Map<string, string>();
        return {
            setData: (format: string, value: string) => store.set(format, value),
            getData: (format: string) => store.get(format) ?? "",
            effectAllowed: "none"
        } as unknown as DataTransfer;
    }

    function drag(cardId: number, column: string): ReturnType<typeof backlog> {
        const state = backlog({
            issues: [
                issue({ id: 1, state: "Todo", title: "Movable" }),
                issue({ id: 2, state: "Done", title: "Settled" })
            ]
        });
        render(<Board backlog={state} />);

        fireEvent.dragStart(screen.getByTestId(`card-${cardId}`), { dataTransfer: dataTransfer() });
        fireEvent.drop(screen.getByTestId(`column-${column}`), { dataTransfer: dataTransfer() });
        return state;
    }

    it("asks the server to move the card that was dragged, to the column it landed in", async () => {
        const requests: { url: string; body: unknown }[] = [];
        vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
            requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(issue()) });
        });

        try {
            const state = drag(1, "In Progress");
            await waitFor(() => expect(state.calls).toHaveLength(1));

            // The request itself, not just that `mutate` was called: this is what pins the card's id and
            // the target state together.
            expect(requests).toEqual([{ url: "/api/issues/1", body: { state: "In Progress" } }]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    /**
     * Dropping a card back where it started is not a change. Writing anyway would bump `updated` and add an
     * event recording that nothing happened.
     */
    it("does nothing when the card is dropped on the column it came from", async () => {
        const state = drag(1, "Todo");
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.calls).toHaveLength(0);
    });

    it("does nothing when a drop arrives with no drag in progress", async () => {
        const state = backlog({ issues: [issue({ id: 1 })] });
        render(<Board backlog={state} />);

        fireEvent.drop(screen.getByTestId("column-Done"));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.calls).toHaveLength(0);
    });
});
