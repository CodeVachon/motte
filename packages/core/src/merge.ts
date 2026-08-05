import { findDependencyCycle } from "./deps.js";
import { descendants } from "./tree.js";
import type { Event } from "./schema/event.js";
import type { Issue } from "./schema/issue.js";

/**
 * Folding one issue into another.
 *
 * Two agents file the same work for the same reason two branches mint the same id: nobody is coordinating.
 * `renumber` repairs the id collision; this repairs the content one.
 *
 * Nothing is destroyed. The notes and children move, the blockers merge, and everything the source said in
 * its own words — its description and its plan — goes onto the survivor as a note rather than being dropped,
 * because "these two are the same issue" is a judgement about the work, not permission to delete somebody's
 * writing. The source leaves a tombstone, so its number still leads somewhere.
 */

export class MergeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MergeError";
    }
}

export interface MergePlan {
    from: Issue;
    into: Issue;
    /** Children of the source, which become children of the survivor. */
    children: Issue[];
    /** Issues blocked by the source, which will be blocked by the survivor instead. */
    dependents: Issue[];
    /** Blockers the survivor gains from the source. */
    blockers: number[];
    /** What the survivor's `blockedBy` becomes: its own, minus the source, plus what it gains. */
    blockedByAfter: number[];
    /** The parent the survivor inherits, when it had none and the source did. */
    parent?: number;
    /** Labels the survivor gains. */
    labels: string[];
    /** Notes moving across. */
    notes: number;
    /** True when the source's description or plan will be preserved as a note. */
    keepsBody: boolean;
}

/**
 * Refuse a merge that would leave two issues waiting on each other.
 *
 * Rewriting "waits on the duplicate" into "waits on the survivor" can close a loop the original relations
 * did not have: #3 waits on the duplicate, the survivor waits on #3, and after the merge those two wait on
 * each other, so neither can ever be ready. `IssueStore.update` would catch it — but only partway through,
 * with the survivor already written and the duplicate still on disk, which is the one outcome worth going
 * out of the way to prevent.
 *
 * Only a *new* cycle counts. A backlog that already contains one is a problem `motte doctor` reports, and
 * it must not block an unrelated merge.
 */
function assertNoNewDependencyCycle(
    issues: Issue[],
    change: { fromId: number; intoId: number; blockedByAfter: number[]; dependents: number[] }
): void {
    const after = issues
        .filter((issue) => issue.id !== change.fromId)
        .map((issue) => {
            if (issue.id === change.intoId) return { ...issue, blockedBy: change.blockedByAfter };
            if (!change.dependents.includes(issue.id)) return issue;

            const blockedBy = (issue.blockedBy ?? []).filter(
                (blocker) => blocker !== change.fromId
            );
            return {
                ...issue,
                blockedBy: blockedBy.includes(change.intoId)
                    ? blockedBy
                    : [...blockedBy, change.intoId]
            };
        });

    for (const id of [change.intoId, ...change.dependents]) {
        const cycle = findDependencyCycle(after, id);
        if (cycle === undefined || findDependencyCycle(issues, id) !== undefined) continue;

        throw new MergeError(
            `merging #${change.fromId} into #${change.intoId} would leave ` +
                `${cycle.map((step) => `#${step}`).join(" → ")} waiting on each other, so none of them ` +
                `could ever be ready. Clear one of those blockers first.`
        );
    }
}

/**
 * What a merge would do, or why it will not happen.
 *
 * Refuses a pair that is related, which is the case the plan for #0090 named: merging a parent into its own
 * child is not a request, it is a mistake with a plausible-looking command. Ancestry either way counts —
 * folding a grandparent into a grandchild is the same error one level further out.
 */
export function planMerge(issues: readonly Issue[], fromId: number, intoId: number): MergePlan {
    const from = issues.find((issue) => issue.id === fromId);
    const into = issues.find((issue) => issue.id === intoId);

    if (from === undefined) throw new MergeError(`no issue #${fromId}`);
    if (into === undefined) throw new MergeError(`no issue #${intoId}`);

    if (fromId === intoId) throw new MergeError("an issue cannot be merged into itself");

    const list = [...issues];
    if (descendants(list, fromId).some((issue) => issue.id === intoId)) {
        throw new MergeError(
            `#${intoId} is beneath #${fromId} in the tree. Merging a parent into its own child would ` +
                `lose the hierarchy — move the children out first if that is really what you want.`
        );
    }
    if (descendants(list, intoId).some((issue) => issue.id === fromId)) {
        throw new MergeError(
            `#${fromId} is beneath #${intoId} in the tree, so it is already part of it. ` +
                `Use \`motte edit ${fromId} --parent none\` first if the two really are one issue.`
        );
    }

    const children = issues.filter((issue) => issue.parent === fromId);

    // The survivor is excluded even when it was blocked by the source: rewriting that one to point at the
    // new blocker would leave it blocking itself. Both directions of a relation between the two are dropped
    // for the same reason — a self-block is not a statement about anything.
    const dependents = issues.filter(
        (issue) => issue.id !== intoId && (issue.blockedBy ?? []).includes(fromId)
    );

    const held = (into.blockedBy ?? []).filter((blocker) => blocker !== fromId);
    const blockers = (from.blockedBy ?? []).filter(
        (blocker) => blocker !== intoId && !held.includes(blocker)
    );

    const labels = (from.labels ?? []).filter((label) => !(into.labels ?? []).includes(label));

    const blockedByAfter = [...held, ...blockers];
    assertNoNewDependencyCycle(list, {
        fromId,
        intoId,
        blockedByAfter,
        dependents: dependents.map((issue) => issue.id)
    });

    return {
        from,
        into,
        children,
        dependents,
        blockers,
        blockedByAfter,
        // Inherited only when the survivor is a root, so a merge never moves an issue out of the epic it
        // was planned under. When neither has a parent this is absent and nothing changes.
        ...(into.parent === undefined && from.parent !== undefined && from.parent !== intoId
            ? { parent: from.parent }
            : {}),
        labels,
        notes: from.notes.length,
        keepsBody: from.description.trim().length > 0 || from.plan.trim().length > 0
    };
}

/**
 * The source's own words, as a note on the survivor.
 *
 * Written rather than dropped, and written as a note rather than appended to the survivor's description,
 * because a description is what an issue *is* and two of them concatenated is neither.
 */
export function mergedBody(from: Issue): string {
    const parts = [`Merged from #${String(from.id).padStart(4, "0")} — “${from.title}”.`];

    if (from.notes.length > 0) {
        // Said explicitly because the moved notes keep their own dates, so they sort in among the
        // survivor's own rather than arriving in a block after this one.
        parts.push(
            `\nIts ${from.notes.length} note${from.notes.length === 1 ? "" : "s"} moved here too, ` +
                `dated when they were written.`
        );
    }
    if (from.description.trim().length > 0) {
        parts.push(`\nWhat it said:\n\n${from.description.trim()}`);
    }
    if (from.plan.trim().length > 0) {
        parts.push(`\nIts plan:\n\n${from.plan.trim()}`);
    }

    return parts.join("\n");
}

/**
 * Where a merged id went, if it went anywhere.
 *
 * The last tombstone wins, the same rule `restore` uses: an id can only have been merged once, but a
 * renumber or a restore could have put it back into use and merged it again.
 */
export function mergedInto(
    events: readonly Event[],
    id: number
): { into: number; title: string; at: string; by: string } | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type !== "merged" || event.id !== id) continue;

        return { into: event.into, title: event.title, at: event.at, by: event.by };
    }

    return undefined;
}
