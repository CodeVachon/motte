import {
    padId,
    projectReport,
    stateCategory,
    type Change,
    type Config,
    type Issue
} from "@motte/core";
import { dim, paintId, paintState, progressLine, warn } from "../ui/format.js";

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
                case "merged":
                    return `merged into #${padId(change.event.into)}  ${dim(change.event.title)}`;
            }
    }
}

/**
 * One line in the stream: when, which issue, what, and who — and which project, when there is more than one.
 *
 * The project's own config does the colouring, not some ambient one. Two projects can name and order their
 * states differently, and a change from one rendered against the other's palette would be quietly wrong.
 */
export function changeLine(project: ProjectView, change: Change, labelWidth = 0): string {
    const when = whenOfChange(change);
    const id = change.kind === "event" ? change.event.id : change.id;
    const actor = actorOf(change);
    const label = labelWidth === 0 ? "" : `${dim(pad(project.name, labelWidth))}  `;

    return (
        `${dim(when)}  ${label}${paintId(id)}  ${describeChange(project.config, change)}` +
        (actor === undefined ? "" : `  ${dim(actor)}`)
    );
}

/** Cut or padded to a fixed width, so the columns line up whatever the projects are called. */
function pad(text: string, width: number): string {
    return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
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

/** One project being watched, with its own states and its own reading of the backlog. */
export interface ProjectView {
    name: string;
    config: Config;
    issues: Issue[];
    /** Set when this project's backlog could not be read. The others carry on. */
    problem?: string | undefined;
}

/** A change, and which project it came from. */
export interface TaggedChange {
    project: ProjectView;
    change: Change;
}

/**
 * Several projects at once: the total first, then a line each.
 *
 * The total is summed from each project's own report rather than by pooling the issues, because "done" and
 * "cancelled" are per-project names — one project's Shipped is another's Done, and only its own config
 * knows which category a state belongs to.
 */
export function overviewLines(projects: readonly ProjectView[]): string[] {
    const reports = projects.map((project) => ({
        project,
        report: projectReport(project.config, project.issues)
    }));

    const total = reports.reduce(
        (sum, { report }) => ({
            completed: sum.completed + report.completed,
            started: sum.started + report.started,
            unstarted: sum.unstarted + report.unstarted,
            cancelled: sum.cancelled + report.cancelled,
            counted: sum.counted + report.counted
        }),
        { completed: 0, started: 0, unstarted: 0, cancelled: 0, counted: 0 }
    );

    const percentComplete =
        total.counted === 0 ? 0 : Math.round((total.completed / total.counted) * 100);

    const lines = [progressLine({ ...total, percentComplete, total: total.counted }), ""];

    const width = Math.max(...projects.map((project) => project.name.length), 1);

    for (const { project, report } of reports) {
        // A project that could not be read says so in its own row rather than being left out: a row that
        // silently vanished would read as "nothing happening there".
        if (project.problem !== undefined) {
            lines.push(`  ${pad(project.name, width)}  ${warn(project.problem)}`);
            continue;
        }

        const flight = project.issues.filter(
            (issue) => stateCategory(project.config, issue.state) === "started"
        );

        lines.push(
            // Percent right-aligned to four, so `100%` and `0%` leave the counts beside them in one column.
            // Read off a real three-project frame, where the ragged version was the only thing that looked
            // wrong about it.
            `  ${pad(project.name, width)}  ${dim(`${report.percentComplete}%`.padStart(4))}` +
                `  ${dim(`${report.completed}/${report.counted}`)}` +
                (flight.length === 0
                    ? ""
                    : `  ${flight
                          .map(
                              (issue) =>
                                  `${paintId(issue.id)} ${paintState(project.config, issue.state)}` +
                                  (issue.assignee === undefined ? "" : ` ${dim(issue.assignee)}`)
                          )
                          .join(dim(" · "))}`)
        );
    }

    return lines;
}

export interface FrameModel {
    /** Every project being watched. One of these is the ordinary `motte watch`. */
    projects: ProjectView[];
    /** Most recent last, which is the order a stream is read in. */
    changes: TaggedChange[];
    /** False once the watcher has given up, so the frame can say the view is no longer live. */
    live: boolean;
    /** Shown instead of the summary when nothing can be read at all. */
    problem?: string | undefined;
    /** Registered projects left unwatched, because there is a limit on how many to open at once. */
    omitted?: number;
}

export interface Viewport {
    columns: number;
    rows: number;
}

/**
 * Cut a block to fit, saying how much was left out.
 *
 * The frame used to trim only the stream, on the grounds that scrolling its own header away would be worse
 * than showing less history — but the summary can be taller than the window too, and then the whole frame
 * overflowed and did exactly that. Eight projects with work in flight, or one project with thirty started
 * issues, both reach it.
 */
function fit(block: readonly string[], rows: number): string[] {
    if (rows <= 0) return [];
    if (block.length <= rows) return [...block];

    const kept = block.slice(0, Math.max(0, rows - 1));
    return [...kept, dim(`  +${block.length - kept.length} more`)];
}

/**
 * A whole frame.
 *
 * One renderer for one project and for twenty, rather than two that have to agree: watching several is the
 * same view with a project column and a total on top.
 *
 * Never taller than the window. Both halves are cut to fit — the stream keeps the newest, the summary keeps
 * the top and counts the rest — because a frame that overflows scrolls its own header off the screen.
 */
export function frame(model: FrameModel, viewport: Viewport): string[] {
    const several = model.projects.length > 1;
    const first = model.projects[0];

    const title = several
        ? `${model.projects.length} projects` +
          (model.omitted === undefined || model.omitted === 0
              ? ""
              : dim(`  (${model.omitted} more not watched)`))
        : (first?.name ?? "no project");

    const lines = [`${title}${model.live ? "" : dim("  (not watching)")}`, ""];

    const summary =
        model.problem !== undefined
            ? [model.problem]
            : several
              ? overviewLines(model.projects)
              : first === undefined
                ? []
                : // A single project's own problem stands in for its summary, as it always did.
                  first.problem === undefined
                  ? summaryLines(first.config, first.issues)
                  : [first.problem];

    // Reserved: this header (2), the "changes" heading (2), one line of stream, and the hint (2).
    if (summary.length > 0) lines.push(...fit(summary, viewport.rows - 7), "");

    lines.push(dim("changes"), "");

    // Two reserved: the hint at the bottom and the blank line above it.
    const room = Math.max(0, viewport.rows - lines.length - 2);

    // `slice(-0)` is `slice(0)`, which is the whole array — so no room has to be spelled out. Left
    // implicit, a window with nothing to spare printed the entire history instead of none of it.
    const recent = room === 0 ? [] : model.changes.slice(-room);

    if (recent.length === 0) {
        // Only if there is room for it: on a window too short for everything, a placeholder is the first
        // thing to give up.
        if (room > 0) lines.push(dim("  waiting…"));
    } else {
        const width = several
            ? Math.max(...model.projects.map((project) => project.name.length), 1)
            : 0;

        for (const tagged of recent) {
            lines.push(`  ${changeLine(tagged.project, tagged.change, width)}`);
        }
    }

    lines.push("", dim("  ctrl-c to stop"));

    // The invariant, enforced rather than merely intended: on a window too small for even the reserved
    // rows, something has to go, and it is the bottom — the header is what a reader needs most, and losing
    // it to a scroll is the failure this whole function is arranged to avoid.
    return lines.slice(0, Math.max(1, viewport.rows));
}
