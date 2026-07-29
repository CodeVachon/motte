import { z } from "zod";

export const AuthorTypeSchema = z.enum(["user", "agent"]);

export type AuthorType = z.infer<typeof AuthorTypeSchema>;

export interface Author {
    name: string;
    type: AuthorType;
}

export interface Note {
    /** ISO-8601 with second precision, as written in the note heading. */
    at: string;
    author: Author;
    body: string;
}

/**
 * The structured half of an issue file — everything between the `---` fences.
 *
 * `state` is validated against the project's configured states separately (see `validateIssue`),
 * not with an enum here, because the state list is per-project.
 */
export const FrontmatterSchema = z.object({
    id: z.number().int().positive(),
    title: z.string().min(1),
    state: z.string().min(1),
    parent: z.number().int().positive().optional(),
    assignee: z.string().min(1).optional(),
    labels: z.array(z.string().min(1)).optional(),
    /**
     * Issues that must be complete before this one can start.
     *
     * Only this direction is stored. The inverse — what an issue blocks — is derived at read time,
     * because a two-sided relation in hand-edited, git-merged files will drift, and then two files
     * disagree about reality with no tiebreaker.
     */
    blockedBy: z.array(z.number().int().positive()).optional(),
    created: z.string().min(1),
    updated: z.string().min(1)
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** A section of the body that motte does not know about, preserved verbatim on rewrite. */
export interface UnknownSection {
    heading: string;
    body: string;
    /**
     * Which known section this followed in the original file, so it can be restored to the same
     * place. `null` means it came before every known section.
     */
    after: "description" | "plan" | "notes" | null;
}

export interface Issue extends Frontmatter {
    description: string;
    plan: string;
    notes: Note[];
    unknownSections: UnknownSection[];
    /** Absolute path to the file this was read from. Absent for issues not yet written. */
    filePath?: string;
}

export type NewIssue = {
    title: string;
    state?: string;
    parent?: number;
    assignee?: string;
    labels?: string[];
    blockedBy?: number[];
    description?: string;
    plan?: string;
};

export type IssuePatch = {
    title?: string;
    state?: string;
    parent?: number | null;
    assignee?: string | null;
    labels?: string[];
    blockedBy?: number[];
    description?: string;
    plan?: string;
};
