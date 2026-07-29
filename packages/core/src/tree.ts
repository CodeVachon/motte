import type { Issue } from "./schema/issue.js";

export interface TreeNode {
    issue: Issue;
    depth: number;
    children: TreeNode[];
}

export interface TreeProblem {
    kind: "missing-parent" | "cycle" | "duplicate-id";
    issues: Issue[];
    message: string;
}

export interface TreeResult {
    roots: TreeNode[];
    problems: TreeProblem[];
}

/**
 * Build the parent/child forest from flat frontmatter.
 *
 * Issues whose parent does not exist are surfaced as problems *and* promoted to roots, so a broken
 * link never hides work from `motte list --tree`.
 */
export function buildTree(issues: Issue[]): TreeResult {
    const problems: TreeProblem[] = [];

    const byId = new Map<number, Issue>();
    const duplicates = new Map<number, Issue[]>();

    for (const issue of issues) {
        const existing = byId.get(issue.id);
        if (existing) {
            const group = duplicates.get(issue.id) ?? [existing];
            group.push(issue);
            duplicates.set(issue.id, group);
            continue;
        }
        byId.set(issue.id, issue);
    }

    for (const [id, group] of duplicates) {
        problems.push({
            kind: "duplicate-id",
            issues: group,
            message:
                `#${id} is used by ${group.length} files: ` +
                group.map((issue) => issue.filePath ?? issue.title).join(", ")
        });
    }

    const unique = [...byId.values()];

    /** Walk to the root, reporting the first cycle found. */
    const inCycle = new Set<number>();
    for (const issue of unique) {
        const seen = new Set<number>([issue.id]);
        let cursor = issue.parent;

        while (cursor !== undefined) {
            if (seen.has(cursor)) {
                if (!inCycle.has(issue.id)) {
                    const path = [...seen, cursor];
                    for (const id of seen) inCycle.add(id);
                    problems.push({
                        kind: "cycle",
                        issues: [...seen].map((id) => byId.get(id)!).filter(Boolean),
                        message: `parent cycle: ${path.map((id) => `#${id}`).join(" → ")}`
                    });
                }
                break;
            }
            seen.add(cursor);
            cursor = byId.get(cursor)?.parent;
        }
    }

    const nodes = new Map<number, TreeNode>();
    for (const issue of unique) nodes.set(issue.id, { issue, depth: 0, children: [] });

    const roots: TreeNode[] = [];

    for (const issue of unique) {
        const node = nodes.get(issue.id)!;

        if (issue.parent === undefined || inCycle.has(issue.id)) {
            roots.push(node);
            continue;
        }

        const parent = nodes.get(issue.parent);
        if (!parent) {
            problems.push({
                kind: "missing-parent",
                issues: [issue],
                message: `#${issue.id} has parent #${issue.parent}, which does not exist`
            });
            roots.push(node);
            continue;
        }

        parent.children.push(node);
    }

    const assignDepth = (node: TreeNode, depth: number) => {
        node.depth = depth;
        node.children.sort((a, b) => a.issue.id - b.issue.id);
        for (const child of node.children) assignDepth(child, depth + 1);
    };

    roots.sort((a, b) => a.issue.id - b.issue.id);
    for (const root of roots) assignDepth(root, 0);

    return { roots, problems };
}

/** Depth-first flatten, for rendering an indented list. */
export function flattenTree(roots: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (node: TreeNode) => {
        out.push(node);
        for (const child of node.children) walk(child);
    };
    for (const root of roots) walk(root);
    return out;
}

/** Every descendant of `id`, not including `id` itself. */
export function descendants(issues: Issue[], id: number): Issue[] {
    const byParent = new Map<number, Issue[]>();
    for (const issue of issues) {
        if (issue.parent === undefined) continue;
        const group = byParent.get(issue.parent) ?? [];
        group.push(issue);
        byParent.set(issue.parent, group);
    }

    const out: Issue[] = [];
    const queue = [...(byParent.get(id) ?? [])];
    const seen = new Set<number>([id]);

    while (queue.length > 0) {
        const issue = queue.shift()!;
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        out.push(issue);
        queue.push(...(byParent.get(issue.id) ?? []));
    }

    return out.sort((a, b) => a.id - b.id);
}
