import {
    padId,
    projectReport,
    stateCategory,
    type Change,
    type Config,
    type Issue
} from "@motte/core";
import { dim, paintId, paintState, progressLine } from "../ui/format.js";

/**
 * Turning the backlog and a stream of changes into lines.
 *
 * Kept apart from the terminal mechanics so the interesting half can be tested without a terminal: what a
 * frame contains, how a transition reads, and what happens when the window is too small for everything.
 */

/** Clock time only. The date is in the header, and a stream of transitions is read as "just now". */
export function clockOf(at: string): string {
    // Sliced rather than parsed through Date: these are already ISO-8601 in UTC, and going via a local
    // Date would shift every timestamp by the reader's offset from the log they can also read directly.
    const match = /T(\d{2}:\d{2})/.exec(at);
    return match?.[1] ?? "--:--";
}

function actorOf(change: Change): string | undefined {
    if (change.kind === "note") return `${change.note.author.name} (${change.note.author.type})`;
    if (change.kind !== "event") return undefined;

    return change.attributed ? `${change.event.by} (${change.event.as})` : undefined;
}

/** A note body on one line, cut to something a stream can carry. */
function summarise(body: string, width = 48): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/** What happened, without the id or the actor — those are the columns around it. */
export function describeChange(config: Config, change: Change): string {
    switch (change.kind) {
        case "note":
            return `note  ${dim(`“${summarise(change.note.body)}”`)}`;
        case "ready":
            return `ready  ${change.title}`;
        case "removed":
            return `removed  ${dim(change.title)}`;
        case "event":
            switch (change.event.type) {
                case "created":
                    return `created  ${change.title}  ${paintState(config, change.event.state)}`;
                case "state":
                    return `${dim(change.event.from)} → ${paintState(config, change.event.to)}  ${dim(change.title)}`;
                case "title":
                    return `retitled  ${dim(change.event.from)} → ${change.event.to}`;
                case "assigned":
                    return change.event.to === null
                        ? `unassigned  ${dim(change.title)}`
                        : `assigned to ${change.event.to}  ${dim(change.title)}`;
                case "parent":
                    return change.event.to === null
                        ? `unparented  ${dim(change.title)}`
                        : `moved under #${padId(change.event.to)}  ${dim(change.title)}`;
                case "blocked":
                    return `blocked by #${padId(change.event.blocker)}  ${dim(change.title)}`;
                case "unblocked":
                    return `unblocked from #${padId(change.event.blocker)}  ${dim(change.title)}`;
                case "pruned":
                    return `pruned  ${dim(change.event.title)}`;
                case "restored":
                    return `restored  ${dim(change.title)}`;
            }
    }
}

/** One line in the stream: when, which issue, what, and who. */
export function changeLine(config: Config, change: Change): string {
    const when = whenOfChange(change);
    const id = change.kind === "event" ? change.event.id : change.id;
    const actor = actorOf(change);

    return (
        `${dim(when)}  ${paintId(id)}  ${describeChange(config, change)}` +
        (actor === undefined ? "" : `  ${dim(actor)}`)
    );
}

function whenOfChange(change: Change): string {
    if (change.kind === "event") return clockOf(change.event.at);
    if (change.kind === "note") return clockOf(change.note.at);

    // Nothing on disk stamps these: a removal leaves nothing to read, and readiness is a consequence of
    // some other change rather than an act of its own.
    return "  ·  ";
}

/**
 * The pinned part: where the project stands, and who is on what.
 *
 * In-flight rather than a full list, because the whole point of watching is the work that is moving. An
 * unassigned started issue still appears — it is in flight whether or not anybody claimed it.
 */
export function summaryLines(config: Config, issues: Issue[]): string[] {
    const report = projectReport(config, issues);
    const started = issues.filter((issue) => stateCategory(config, issue.state) === "started");

    const lines = [progressLine(report), ""];

    if (started.length === 0) {
        lines.push(dim("nothing in flight"));
        return lines;
    }

    for (const issue of started) {
        lines.push(
            `  ${paintId(issue.id)}  ${paintState(config, issue.state)}  ${issue.title}` +
                (issue.assignee === undefined ? "" : `  ${dim(issue.assignee)}`)
        );
    }

    return lines;
}

export interface FrameModel {
    issues: Issue[];
    /** Most recent last, which is the order a stream is read in. */
    changes: Change[];
    /** False once the watcher has given up, so the frame can say the view is no longer live. */
    live: boolean;
    /** Shown instead of the summary when the backlog cannot be read at all. */
    problem?: string | undefined;
}

export interface Viewport {
    columns: number;
    rows: number;
}

/**
 * A whole frame.
 *
 * The stream is cut to whatever is left after the summary, keeping the newest — a dashboard that scrolled
 * its own header off the top would be worse than one that shows less history.
 */
export function frame(config: Config, model: FrameModel, viewport: Viewport): string[] {
    const header = `${config.name}${model.live ? "" : dim("  (not watching)")}`;
    const lines = [header, ""];

    if (model.problem !== undefined) {
        lines.push(model.problem, "");
    } else {
        lines.push(...summaryLines(config, model.issues), "");
    }

    lines.push(dim("changes"), "");

    // Two reserved: the hint at the bottom and the blank line above it.
    const room = Math.max(0, viewport.rows - lines.length - 2);
    const recent = model.changes.slice(-room);

    if (recent.length === 0) {
        lines.push(dim("  waiting…"));
    } else {
        for (const change of recent) lines.push(`  ${changeLine(config, change)}`);
    }

    lines.push("", dim("  ctrl-c to stop"));

    return lines;
}
