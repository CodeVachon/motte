/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tree } from "./Tree.js";
import { backlog, issue } from "../testing/fixtures.js";

afterEach(cleanup);

/** jsdom has no DataTransfer, and the handlers set data on it during dragStart. */
function dataTransfer(): DataTransfer {
    const store = new Map<string, string>();
    return {
        setData: (format: string, value: string) => store.set(format, value),
        getData: (format: string) => store.get(format) ?? "",
        effectAllowed: "none"
    } as unknown as DataTransfer;
}

function reparent(from: number, onto: number | "root"): ReturnType<typeof backlog> {
    const state = backlog({
        issues: [
            issue({ id: 1, title: "Parent" }),
            issue({ id: 2, title: "Child", parent: 1 }),
            issue({ id: 3, title: "Loose" })
        ]
    });
    render(<Tree backlog={state} />);

    fireEvent.dragStart(screen.getByTestId(`tree-row-${from}`), { dataTransfer: dataTransfer() });

    const target =
        onto === "root"
            ? screen.getByTestId("tree-root-target")
            : screen.getByTestId(`tree-row-${onto}`);
    fireEvent.dragOver(target, { dataTransfer: dataTransfer() });
    fireEvent.drop(target, { dataTransfer: dataTransfer() });

    return state;
}

describe("the hierarchy", () => {
    it("nests a child under its parent, and indents it", () => {
        render(
            <Tree
                backlog={backlog({
                    issues: [
                        issue({ id: 1, title: "Parent" }),
                        issue({ id: 2, title: "Child", parent: 1 })
                    ]
                })}
            />
        );

        const parent = screen.getByTestId("tree-row-1");
        const child = screen.getByTestId("tree-row-2");

        expect(parent.style.paddingLeft).toBe("0.5rem");
        expect(child.style.paddingLeft).toBe("1.75rem");
    });

    it("nests to any depth", () => {
        render(
            <Tree
                backlog={backlog({
                    issues: [
                        issue({ id: 1 }),
                        issue({ id: 2, parent: 1 }),
                        issue({ id: 3, parent: 2 })
                    ]
                })}
            />
        );

        expect(screen.getByTestId("tree-row-3").style.paddingLeft).toBe("3rem");
    });

    /**
     * An issue whose parent is not in the list — pruned, or a file gone missing. Hiding it would be the worst
     * option: it exists, and `motte doctor` is what reports the inconsistency.
     */
    it("shows an issue whose parent is missing, and says so", () => {
        render(<Tree backlog={backlog({ issues: [issue({ id: 5, parent: 99 })] })} />);

        expect(screen.getByTestId("tree-row-5")).toBeDefined();
        expect(screen.getByTestId("tree").textContent).toContain("#5");
        expect(screen.getByTestId("tree").textContent).toContain("motte doctor");
    });

    it("says nothing about orphans when there are none", () => {
        render(<Tree backlog={backlog({ issues: [issue({ id: 1 })] })} />);

        expect(screen.getByTestId("tree").textContent).not.toContain("motte doctor");
    });
});

describe("drag to re-parent", () => {
    it("asks the server to set the new parent", async () => {
        const requests: { url: string; body: unknown }[] = [];
        vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
            requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(issue()) });
        });

        try {
            const state = reparent(3, 1);
            await waitFor(() => expect(state.calls).toHaveLength(1));

            expect(requests).toEqual([{ url: "/api/issues/3", body: { parent: 1 } }]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    /** The dashed target exists because no row represents "no parent". */
    it("clears the parent when dropped on the top-level target", async () => {
        const requests: { body: unknown }[] = [];
        vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
            requests.push({ body: JSON.parse(String(init?.body ?? "null")) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(issue()) });
        });

        try {
            const state = reparent(2, "root");
            await waitFor(() => expect(state.calls).toHaveLength(1));

            expect(requests).toEqual([{ body: { parent: null } }]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    /**
     * Dropping something onto itself is the one invalid move this view can be sure of. Every other rule —
     * cycles through descendants — belongs to the server, which answers 409, and the banner shows why.
     */
    it("ignores a drop onto the row being dragged", async () => {
        const state = reparent(1, 1);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.calls).toHaveLength(0);
    });

    it("does nothing when the parent would not change", async () => {
        const state = reparent(2, 1);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.calls).toHaveLength(0);
    });
});
