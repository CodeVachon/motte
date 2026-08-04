/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Reports } from "./Reports.js";
import { backlog, status } from "../testing/fixtures.js";

afterEach(cleanup);

describe("Reports", () => {
    it("shows the overall figures the server reported", () => {
        render(
            <Reports
                backlog={backlog({
                    status: status({
                        total: 10,
                        counted: 9,
                        completed: 4,
                        percentComplete: 44,
                        ready: [1, 2],
                        blocked: [3],
                        byState: [
                            { state: "Todo", category: "unstarted", count: 5 },
                            { state: "Done", category: "completed", count: 4 },
                            { state: "Cancelled", category: "cancelled", count: 1 }
                        ]
                    })
                })}
            />
        );

        expect(screen.getByTestId("overall-percent").textContent).toBe("44%");
        const text = screen.getByTestId("reports").textContent ?? "";
        expect(text).toContain("10");
        expect(text).toContain("Ready");
    });

    /**
     * The rollups come from the server, which computes them with core's `epicReports`. This view worked them
     * out itself once and disagreed with `motte status --epics` — direct children only, and excluding the epic
     * — so what matters here is that it renders what it was given and invents nothing.
     */
    it("renders the epic rollups exactly as given", () => {
        render(
            <Reports
                backlog={backlog({
                    status: status({
                        epics: [
                            {
                                id: 1,
                                title: "Ship the web UI",
                                state: "In Progress",
                                total: 5,
                                counted: 5,
                                completed: 1,
                                percentComplete: 20
                            }
                        ]
                    })
                })}
            />
        );

        const epic = screen.getByTestId("epic-1").textContent ?? "";
        expect(epic).toContain("#0001");
        expect(epic).toContain("Ship the web UI");
        expect(epic).toContain("1/5");
        expect(epic).toContain("20%");
    });

    it("explains the empty case rather than showing an empty list", () => {
        render(<Reports backlog={backlog()} />);

        expect(screen.getByTestId("reports").textContent).toContain("No issue has children yet");
    });

    it("renders nothing at all before the status has loaded", () => {
        const { container } = render(<Reports backlog={backlog({ status: undefined })} />);

        expect(container.textContent).toBe("");
    });
});
