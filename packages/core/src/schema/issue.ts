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
    description?: string;
    plan?: string;
};

export type IssuePatch = {
    title?: string;
    state?: string;
    parent?: number | null;
    assignee?: string | null;
    labels?: string[];
    description?: string;
    plan?: string;
};
