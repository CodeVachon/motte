import { stateCategory } from "./config.js";
import { isSettled, ready } from "./deps.js";
import { buildTree, flattenTree } from "./tree.js";
import type { Config } from "./schema/config.js";
import type { Issue } from "./schema/issue.js";

/**
 * Which issue to pick up next.
 *
 * `ready` answers "what could be started" and returns it in id order, so an agent facing fifteen ready
 * issues picks the lowest number — which is arbitrary. This orders that set.
 *
 * No new fields on disk. Everything it weighs is already recorded: the dependency graph says what a piece
 * of work would unblock, the tree says whether it is a leaf, and the timestamps say what has been waiting.
 *
 * Lexicographic rather than a weighted score. Weights would need defending — why is unblocking two issues
 * worth more than three days of age? — and the answer would be invented. A sequence of comparisons can be
 * stated in a sentence instead, which is what `--why` prints, and an ordering nobody can argue with is one
 * nobody trusts.
 */

export interface RankSignals {
    /** Unsettled issues that are waiting on this one, directly or through a chain. */
    unblocks: number;
    /** Depth in the parent tree. Deeper means closer to a leaf, and leaves are what finish epics. */
    depth: number;
    /** Already assigned to the caller. */
    mine: boolean;
    /** Already started, by the caller. */
    inProgress: boolean;
}

export interface Ranked {
    issue: Issue;
    signals: RankSignals;
    /** Why it sits where it does, in the order the comparisons were made. */
    reasons: string[];
}

export interface RankOptions {
    /** Who is asking. Without it, nothing is "mine" and assignment is ignored entirely. */
    assignee?: string | undefined;
    /** Only issues assigned to the caller. */
    mineOnly?: boolean;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    return a.toLowerCase() === b.toLowerCase();
}

/**
 * Everything that would be freed by finishing `id`, transitively.
 *
 * Settled dependents are not counted: finishing this cannot help work that is already done, and counting
 * them would make an old issue under a closed epic look urgent.
 */
function unblockCount(config: Config, issues: readonly Issue[], id: number): number {
    const dependents = new Map<number, number[]>();
    for (const issue of issues) {
        for (const blocker of issue.blockedBy ?? []) {
            dependents.set(blocker, [...(dependents.get(blocker) ?? []), issue.id]);
        }
    }

    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const seen = new Set<number>([id]);
    const queue = [...(dependents.get(id) ?? [])];
    let count = 0;

    while (queue.length > 0) {
        const next = queue.shift()!;
        if (seen.has(next)) continue;
        seen.add(next);

        const issue = byId.get(next);
        // A dangling blocker reference is `doctor`'s problem to report, not this function's to trip over.
        if (issue === undefined) continue;

        if (!isSettled(config, issue)) count += 1;
        queue.push(...(dependents.get(next) ?? []));
    }

    return count;
}

function depths(issues: readonly Issue[]): Map<number, number> {
    const depth = new Map<number, number>();
    for (const node of flattenTree(buildTree([...issues]).roots)) {
        depth.set(node.issue.id, node.depth);
    }
    return depth;
}

/**
 * The ready set, in the order it should be picked up.
 *
 * Work assigned to somebody else is left out. That is the multi-agent case this exists for: an issue with
 * another name on it is spoken for, and handing it to a second agent is how two of them end up writing the
 * same code. Unassigned work is fair game for anyone.
 */
export function rankReady(config: Config, issues: Issue[], options: RankOptions = {}): Ranked[] {
    const depth = depths(issues);

    /**
     * Parents whose work is really their children's.
     *
     * Not "has unsettled children" — that was the first attempt and it hid the wrong things. In this
     * project's own backlog a parent sometimes holds the work while its child is a follow-on blocked by it,
     * and excluding every parent with open children took that parent out of the running entirely.
     *
     * The narrower rule: if something under it could be started right now, that is the work and the parent
     * is bookkeeping. If everything under it is blocked or settled, the parent is fair game.
     */
    const startableChildren = new Set(
        ready(config, issues)
            .filter((issue) => issue.parent !== undefined)
            .map((issue) => issue.parent!)
    );

    const candidates = ready(config, issues).filter((issue) => {
        if (startableChildren.has(issue.id)) return false;
        if (sameName(issue.assignee, options.assignee)) return true;
        if (options.mineOnly === true) return false;

        return issue.assignee === undefined;
    });

    const ranked: Ranked[] = candidates.map((issue) => {
        const signals: RankSignals = {
            unblocks: unblockCount(config, issues, issue.id),
            depth: depth.get(issue.id) ?? 0,
            mine: sameName(issue.assignee, options.assignee),
            // The category, not "anything but the default state": a project may configure two unstarted
            // states, and neither of them means work has begun.
            inProgress: stateCategory(config, issue.state) === "started"
        };

        return { issue, signals, reasons: reasonsFor(signals) };
    });

    return ranked.sort(compare);
}

/**
 * The comparison, in words.
 *
 * Work already in hand comes first: an agent that started something and then asked what to do next should
 * be reminded, not handed a second thing. After that it is the graph — what a piece of work releases, then
 * how close it is to a leaf — and then how long it has waited.
 */
function compare(a: Ranked, b: Ranked): number {
    const held =
        Number(b.signals.inProgress && b.signals.mine) -
        Number(a.signals.inProgress && a.signals.mine);
    if (held !== 0) return held;

    if (a.signals.unblocks !== b.signals.unblocks) return b.signals.unblocks - a.signals.unblocks;
    if (a.signals.depth !== b.signals.depth) return b.signals.depth - a.signals.depth;

    const age = a.issue.created.localeCompare(b.issue.created);
    if (age !== 0) return age;

    // Ids last, so the order is stable rather than dependent on directory reading order.
    return a.issue.id - b.issue.id;
}

function reasonsFor(signals: RankSignals): string[] {
    const reasons: string[] = [];

    if (signals.inProgress && signals.mine) reasons.push("already yours, and started");
    else if (signals.mine) reasons.push("assigned to you");

    if (signals.unblocks === 1) reasons.push("unblocks 1 issue");
    else if (signals.unblocks > 1) reasons.push(`unblocks ${signals.unblocks} issues`);

    if (signals.depth > 0) reasons.push(`${signals.depth} deep in the tree`);

    // Deliberately not "oldest": whether it is oldest depends on the rest of the set, and this describes
    // one issue. The caller renders position.
    return reasons;
}
