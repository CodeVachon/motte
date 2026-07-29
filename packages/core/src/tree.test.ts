import { describe, expect, it } from "vitest";
import { buildTree, descendants, flattenTree } from "./tree.js";
import type { Issue } from "./schema/issue.js";

function issue(id: number, parent?: number, filePath?: string): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state: "Todo",
        ...(parent === undefined ? {} : { parent }),
        created: "2026-07-29T12:00:00Z",
        updated: "2026-07-29T12:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...(filePath === undefined ? {} : { filePath })
    };
}

describe("buildTree", () => {
    it("nests children under their parent and sorts by id", () => {
        const { roots, problems } = buildTree([issue(1), issue(3, 1), issue(2, 1)]);

        expect(problems).toEqual([]);
        expect(roots).toHaveLength(1);
        expect(roots[0]!.children.map((node) => node.issue.id)).toEqual([2, 3]);
    });

    it("assigns depth by generation", () => {
        const { roots } = buildTree([issue(1), issue(2, 1), issue(3, 2)]);
        const flat = flattenTree(roots);

        expect(flat.map((node) => [node.issue.id, node.depth])).toEqual([
            [1, 0],
            [2, 1],
            [3, 2]
        ]);
    });

    it("sorts multiple roots by id", () => {
        const { roots } = buildTree([issue(5), issue(2), issue(9)]);
        expect(roots.map((node) => node.issue.id)).toEqual([2, 5, 9]);
    });

    it("promotes an issue with a missing parent to a root and reports it", () => {
        const { roots, problems } = buildTree([issue(1), issue(2, 99)]);

        expect(roots.map((node) => node.issue.id)).toEqual([1, 2]);
        expect(problems).toHaveLength(1);
        expect(problems[0]!.kind).toBe("missing-parent");
        expect(problems[0]!.message).toContain("#99");
    });

    it("detects a two-issue cycle without hanging", () => {
        const { problems, roots } = buildTree([issue(1, 2), issue(2, 1)]);

        expect(problems.some((problem) => problem.kind === "cycle")).toBe(true);
        // Both are surfaced as roots so neither disappears from the listing.
        expect(roots).toHaveLength(2);
    });

    it("detects a longer cycle", () => {
        const { problems } = buildTree([issue(1, 3), issue(2, 1), issue(3, 2)]);
        expect(problems.some((problem) => problem.kind === "cycle")).toBe(true);
    });

    it("detects a self-parent", () => {
        const { problems } = buildTree([issue(1, 1)]);
        expect(problems.some((problem) => problem.kind === "cycle")).toBe(true);
    });

    it("reports duplicate ids and keeps only the first", () => {
        const { roots, problems } = buildTree([
            issue(1, undefined, "a.md"),
            issue(1, undefined, "b.md")
        ]);

        expect(roots).toHaveLength(1);
        const duplicate = problems.find((problem) => problem.kind === "duplicate-id");
        expect(duplicate).toBeDefined();
        expect(duplicate!.message).toContain("a.md");
        expect(duplicate!.message).toContain("b.md");
    });

    it("handles an empty set", () => {
        expect(buildTree([])).toEqual({ roots: [], problems: [] });
    });
});

describe("descendants", () => {
    it("returns the whole subtree, excluding the root itself", () => {
        const issues = [issue(1), issue(2, 1), issue(3, 2), issue(4, 1), issue(5)];

        expect(descendants(issues, 1).map((child) => child.id)).toEqual([2, 3, 4]);
    });

    it("returns nothing for a leaf", () => {
        expect(descendants([issue(1), issue(2, 1)], 2)).toEqual([]);
    });

    it("terminates on a cycle rather than looping forever", () => {
        expect(() => descendants([issue(1, 2), issue(2, 1)], 1)).not.toThrow();
    });
});
