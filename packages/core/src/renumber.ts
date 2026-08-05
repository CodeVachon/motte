import type { Issue } from "./schema/issue.js";
import { issueFilename } from "./slug.js";

/**
 * Repairing a duplicated id.
 *
 * Ids come from scanning the directory rather than from a counter file, because a counter is a write
 * conflict on every single create. The cost of that trade is that two branches can each mint the same
 * number, and this is the other half of it: `doctor` reports the collision, and this works out what to
 * change. Pure — the writing is `IssueStore.renumberFile`.
 */

export interface DuplicateGroup {
    id: number;
    /** Every issue claiming that id, in the order the id should be handed out. */
    issues: Issue[];
}

/**
 * Ids claimed by more than one file.
 *
 * Ordered by `created`, so the issue that had the number first keeps it and whatever was filed later on
 * another branch is what moves. Sorting on the filename breaks a tie, because two issues created in the
 * same second must still renumber the same way on every machine — otherwise two people repairing the same
 * merge get different results and the next merge collides again.
 */
export function duplicateIds(issues: readonly Issue[]): DuplicateGroup[] {
    const byId = new Map<number, Issue[]>();

    for (const issue of issues) {
        byId.set(issue.id, [...(byId.get(issue.id) ?? []), issue]);
    }

    return [...byId.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([id, group]) => ({
            id,
            issues: [...group].sort(
                (a, b) =>
                    a.created.localeCompare(b.created) ||
                    (a.filePath ?? "").localeCompare(b.filePath ?? "")
            )
        }))
        .sort((a, b) => a.id - b.id);
}

export interface Reassignment {
    /** The id it is losing. */
    from: number;
    /** The id it is taking. */
    to: number;
    issue: Issue;
    /** What the file will be called afterwards. */
    filename: string;
}

/** Issues that point at an id, and how. */
export interface Reference {
    issue: Issue;
    via: "parent" | "blockedBy";
}

export interface RenumberPlan {
    reassignments: Reassignment[];
    /**
     * References to a duplicated id, which cannot be reassigned automatically.
     *
     * When two files both claimed #7, a third issue saying `parent: 7` meant one of them, and nothing on
     * disk records which. Rewriting it would be a guess at the shape of someone's backlog, so these are
     * reported for a human to settle. They keep pointing at whichever issue kept the number, which is at
     * least a valid reference rather than a dangling one.
     */
    ambiguous: Reference[];
}

/**
 * What to change to clear every duplicate.
 *
 * New ids continue from the highest in use, so a renumber never re-uses a number that appears in a commit
 * message, a branch name or somebody's memory.
 */
export function planRenumber(issues: readonly Issue[]): RenumberPlan {
    const groups = duplicateIds(issues);
    const ids = issues.map((issue) => issue.id);
    let next = ids.length === 0 ? 1 : Math.max(...ids) + 1;

    const reassignments: Reassignment[] = [];
    const ambiguous: Reference[] = [];

    for (const group of groups) {
        // The first keeps the id; everything after it moves.
        for (const issue of group.issues.slice(1)) {
            reassignments.push({
                from: issue.id,
                to: next,
                issue,
                filename: issueFilename(next, issue.title)
            });
            next += 1;
        }

        for (const issue of issues) {
            if (issue.parent === group.id) ambiguous.push({ issue, via: "parent" });
            if ((issue.blockedBy ?? []).includes(group.id)) {
                ambiguous.push({ issue, via: "blockedBy" });
            }
        }
    }

    return { reassignments, ambiguous };
}
