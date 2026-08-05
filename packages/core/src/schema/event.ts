import { z } from "zod";
import { AuthorTypeSchema } from "./issue.js";

/**
 * Fields every event carries.
 *
 * Short keys on purpose. These lines are written once per transition and never edited, so the file is
 * mostly repeated key names — `at`/`by`/`as` rather than `timestamp`/`author`/`authorType` is a
 * meaningful fraction of the size at scale, and the shape is documented here rather than inline.
 */
const BaseEvent = {
    /** ISO-8601 with second precision, matching the timestamps in issue frontmatter. */
    at: z.string().min(1),
    /** The issue this happened to. */
    id: z.number().int().positive(),
    /** Who did it. */
    by: z.string().min(1),
    /** Whether that was a person or an agent. */
    as: AuthorTypeSchema
};

/**
 * What the log records: transitions the issue files cannot reconstruct.
 *
 * Deliberately absent: notes, which already carry their own timestamp and author in the issue file,
 * and edits to description or plan, whose history is already in `git log -p`. Recording either would
 * be a second copy that can disagree with the first.
 */
export const EventSchema = z.discriminatedUnion("type", [
    z.object({ ...BaseEvent, type: z.literal("created"), title: z.string(), state: z.string() }),
    z.object({ ...BaseEvent, type: z.literal("state"), from: z.string(), to: z.string() }),
    z.object({ ...BaseEvent, type: z.literal("title"), from: z.string(), to: z.string() }),
    z.object({
        ...BaseEvent,
        type: z.literal("assigned"),
        from: z.string().nullable(),
        to: z.string().nullable()
    }),
    z.object({
        ...BaseEvent,
        type: z.literal("parent"),
        from: z.number().int().nullable(),
        to: z.number().int().nullable()
    }),
    z.object({ ...BaseEvent, type: z.literal("blocked"), blocker: z.number().int().positive() }),
    z.object({ ...BaseEvent, type: z.literal("unblocked"), blocker: z.number().int().positive() }),
    /**
     * Written by `motte prune` (#0058). Carries what is needed to recover the issue afterwards, which
     * is the only thing that makes pruning non-destructive.
     */
    z.object({
        ...BaseEvent,
        type: z.literal("pruned"),
        title: z.string(),
        finalState: z.string(),
        path: z.string(),
        commit: z.string()
    }),
    z.object({ ...BaseEvent, type: z.literal("restored"), commit: z.string() }),
    /**
     * Written by `motte merge`. The `id` is the issue that went; `into` is the survivor.
     *
     * A tombstone rather than nothing, so a reference to the old number in a commit message or somebody's
     * memory still leads somewhere — `motte show` on a merged id follows this to the issue that has the
     * work.
     */
    z.object({
        ...BaseEvent,
        type: z.literal("merged"),
        into: z.number().int().positive(),
        title: z.string()
    })
]);

export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];

/** The types this version writes. `pruned` and `restored` come with #0058 and #0059. */
export const TRANSITION_TYPES = [
    "created",
    "state",
    "title",
    "assigned",
    "parent",
    "blocked",
    "unblocked"
] as const satisfies readonly EventType[];
