import { z } from "zod";
import type { IssueField } from "./config.js";

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

/** Values possible in a configured issue field. Dates are represented as their ISO calendar string. */
export type IssueFieldValue = string | number | boolean;

/** Project-defined metadata, keyed by `Config.issueFields[].key`. */
export type IssueFields = Record<string, IssueFieldValue>;

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
    fields?: IssueFields;
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
    fields?: IssueFields;
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
    /** `null` clears an optional configured field. */
    fields?: Record<string, IssueFieldValue | null>;
};

/**
 * Validate YAML-decoded values for configured fields. Kept beside the issue model so all entry
 * points — file parsing, CLI flags, and MCP writes — accept exactly the same values.
 */
export function validateIssueFields(
    declarations: readonly IssueField[],
    values: Record<string, unknown>,
    options: { requireRequired?: boolean } = {}
): IssueFields {
    const declared = new Map(declarations.map((field) => [field.key, field]));
    const output: IssueFields = {};

    for (const key of Object.keys(values)) {
        if (!declared.has(key)) throw new Error(`unknown issue field "${key}"`);
    }

    for (const field of declarations) {
        const value = values[field.key];
        if (value === undefined) {
            if (options.requireRequired === true && field.isRequired) {
                throw new Error(`required issue field "${field.key}" is missing`);
            }
            continue;
        }

        if (field.type === "text") {
            if (typeof value !== "string")
                throw new Error(`issue field "${field.key}" must be text`);
            output[field.key] = value;
        } else if (field.type === "url") {
            if (typeof value !== "string" || !z.url().safeParse(value).success) {
                throw new Error(`issue field "${field.key}" must be a URL`);
            }
            output[field.key] = value;
        } else if (field.type === "number") {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new Error(`issue field "${field.key}" must be a number`);
            }
            output[field.key] = value;
        } else if (field.type === "boolean") {
            if (typeof value !== "boolean") {
                throw new Error(`issue field "${field.key}" must be true or false`);
            }
            output[field.key] = value;
        } else {
            const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : undefined;
            if (
                typeof value !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                date === undefined ||
                Number.isNaN(date.getTime()) ||
                date.toISOString().slice(0, 10) !== value
            ) {
                throw new Error(`issue field "${field.key}" must be an ISO date (YYYY-MM-DD)`);
            }
            output[field.key] = value;
        }
    }

    return output;
}

/** Coerce a `--field key=value` value using the declaration's type. */
export function parseIssueFieldValue(field: IssueField, value: string): IssueFieldValue {
    if (field.type === "number") {
        if (value.trim().length === 0)
            throw new Error(`issue field "${field.key}" must be a number`);
        return validateIssueFields([field], { [field.key]: Number(value) })[field.key]!;
    }
    if (field.type === "boolean") {
        if (value !== "true" && value !== "false") {
            throw new Error(`issue field "${field.key}" must be true or false`);
        }
        return value === "true";
    }
    return validateIssueFields([field], { [field.key]: value })[field.key]!;
}
