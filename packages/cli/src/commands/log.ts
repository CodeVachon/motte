import type { CommandModule } from "yargs";
import { eventsFor, timeInState, type Config, type Event, type Issue } from "@motte/core";
import { context, emitJson } from "../context.js";
import { dim, heading, paintId, paintState } from "../ui/format.js";

/**
 * Parse `--since`.
 *
 * Accepts a relative span (`7d`, `12h`, `30m`) or an absolute date, because "what moved this week" and
 * "what happened after the release" are both common and neither should require converting by hand.
 */
export function parseSince(input: string, now: Date = new Date()): string {
    const relative = /^(\d+)([smhdw])$/.exec(input.trim());

    if (relative) {
        const amount = Number.parseInt(relative[1]!, 10);
        const unit = relative[2]!;
        const seconds = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit]!;
        return `${new Date(now.getTime() - amount * seconds * 1000).toISOString().slice(0, 19)}Z`;
    }

    // A bare number has to be caught before Date.parse, which happily reads "7" as some arbitrary
    // date — so `--since 7` would silently mean something nobody intended.
    if (/^\d+$/.test(input.trim())) {
        throw new Error(
            `"${input}" has no unit. Did you mean ${input.trim()}d? Spans are like 7d, 12h or 30m.`
        );
    }

    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
        throw new Error(
            `could not read "${input}" as a time. Use a span like 7d or 12h, or a date like 2026-07-01.`
        );
    }

    return `${new Date(parsed).toISOString().slice(0, 19)}Z`;
}

export function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;

    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;

    const days = hours / 24;
    return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

/** One line of a timeline. Notes come from the issue files, transitions from the event log. */
interface Entry {
    at: string;
    id: number;
    by: string;
    as: "user" | "agent";
    kind: "event" | "note";
    summary: string;
}

function describeEvent(event: Event): string {
    switch (event.type) {
        case "created":
            return `created "${event.title}" in ${event.state}`;
        case "state":
            return `${event.from} → ${event.to}`;
        case "title":
            return `retitled to "${event.to}"`;
        case "assigned":
            return event.to === null ? `unassigned from ${event.from}` : `assigned to ${event.to}`;
        case "parent":
            return event.to === null ? "made a root issue" : `parented to #${event.to}`;
        case "blocked":
            return `blocked by #${event.blocker}`;
        case "unblocked":
            return `no longer blocked by #${event.blocker}`;
        case "pruned":
            return `pruned (recoverable from ${event.commit})`;
        case "restored":
            return `restored from ${event.commit}`;
    }
}

/**
 * Merge transitions with the notes already in the issue files.
 *
 * Merged at read time rather than stored twice: notes carry their own timestamp and author on the
 * issue, so recording them as events too would mean two records that could disagree.
 */
function timeline(events: Event[], issues: Issue[], since?: string): Entry[] {
    const entries: Entry[] = events.map((event) => ({
        at: event.at,
        id: event.id,
        by: event.by,
        as: event.as,
        kind: "event",
        summary: describeEvent(event)
    }));

    for (const issue of issues) {
        for (const note of issue.notes) {
            if (since !== undefined && note.at < since) continue;
            entries.push({
                at: note.at,
                id: issue.id,
                by: note.author.name,
                as: note.author.type,
                kind: "note",
                summary: note.body.split("\n")[0] ?? ""
            });
        }
    }

    return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function truncate(text: string, width: number): string {
    return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

interface LogArgs {
    ref?: string;
    since?: string;
    limit?: number;
    notes?: boolean;
    json?: boolean;
}

export const logCommand: CommandModule<{}, LogArgs> = {
    command: "log [ref]",
    describe: "What has happened, newest last",
    builder: (yargs) =>
        yargs
            .positional("ref", { type: "string", describe: "Only this issue's history" })
            .option("since", {
                type: "string",
                describe: "A span like 7d or 12h, or a date like 2026-07-01"
            })
            .option("limit", {
                alias: "n",
                type: "number",
                describe: "Show only the last N entries"
            })
            .option("notes", {
                type: "boolean",
                default: true,
                describe: "Include notes alongside transitions (--no-notes for transitions only)"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();

        const since = args.since === undefined ? undefined : parseSince(args.since);
        const issues = store.all();
        const target = args.ref === undefined ? undefined : store.resolve(args.ref);

        const { events, broken } = store.events(since === undefined ? {} : { since });
        const scoped = target === undefined ? events : eventsFor(events, target.id);

        let entries = timeline(
            scoped,
            args.notes === false ? [] : target === undefined ? issues : [target],
            since
        );

        if (args.limit !== undefined && args.limit > 0) entries = entries.slice(-args.limit);

        if (args.json === true) {
            emitJson({
                count: entries.length,
                since: since ?? null,
                entries,
                ...(target === undefined
                    ? {}
                    : { timeInState: Object.fromEntries(timeInState(events, target.id)) }),
                broken
            });
            return;
        }

        const out = process.stdout;

        if (entries.length === 0) {
            // `events` is already filtered, so an empty result with a --since only means nothing fell
            // in range. Saying "no history recorded yet" there would be wrong and misleading.
            const message =
                since !== undefined
                    ? "nothing in that range"
                    : store.events().events.length === 0
                      ? "no history recorded yet — the log starts from the first change after it was enabled"
                      : target === undefined
                        ? "nothing to show"
                        : `nothing recorded for ${paintId(target.id)} yet`;

            out.write(`${dim(message)}\n`);
            return;
        }

        for (const entry of entries) {
            const who = entry.as === "agent" ? dim(`${entry.by} (agent)`) : dim(entry.by);
            const marker = entry.kind === "note" ? dim("note") : "    ";
            out.write(
                `${dim(entry.at.slice(0, 16).replace("T", " "))}  ${paintId(entry.id)} ` +
                    `${marker} ${truncate(entry.summary, 60).padEnd(60)} ${who}\n`
            );
        }

        if (target !== undefined) writeTimeInState(config, store.events().events, target);

        out.write(`\n${dim(`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`)}\n`);
    }
};

function writeTimeInState(config: Config, events: Event[], issue: Issue): void {
    const totals = timeInState(events, issue.id);
    if (totals.size === 0) return;

    const out = process.stdout;
    out.write(`\n${heading("Time in state")}\n\n`);

    const width = Math.max(...[...totals.keys()].map((state) => state.length));
    for (const [state, ms] of totals) {
        out.write(
            `  ${paintState(config, state)}${" ".repeat(width - state.length)}  ${formatDuration(ms)}\n`
        );
    }
}
