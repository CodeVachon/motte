import { z } from "zod";

/**
 * Every state belongs to a category. Reports key off the category rather than the state name so a
 * project that renames "Done" to "Shipped" still gets correct numbers.
 */
export const StateCategorySchema = z.enum(["unstarted", "started", "completed", "cancelled"]);

export type StateCategory = z.infer<typeof StateCategorySchema>;

export const StateSchema = z.object({
    name: z.string().min(1),
    category: StateCategorySchema,
    /** Optional hex colour, used by the web UI. */
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
});

export type State = z.infer<typeof StateSchema>;

export const DEFAULT_STATES: State[] = [
    { name: "Todo", category: "unstarted" },
    { name: "In Progress", category: "started" },
    { name: "Done", category: "completed" }
];

export const EventsSchema = z.object({
    /**
     * Whether transitions are recorded to `.motte/events/`.
     *
     * No retention settings live here on purpose: pruning is a deliberate, manually triggered
     * operation (see `motte prune`), never something that happens on a schedule.
     */
    enabled: z.boolean().default(true)
});

export type EventsConfig = z.infer<typeof EventsSchema>;

/** The scalar types that a project may add to every issue's YAML frontmatter. */
export const IssueFieldTypeSchema = z.enum(["text", "url", "number", "boolean", "date"]);

export type IssueFieldType = z.infer<typeof IssueFieldTypeSchema>;

/**
 * Configured issue metadata. Values live at the top level of each issue's frontmatter so they stay
 * useful to people and tools that read the Markdown files directly.
 */
export const IssueFieldSchema = z.object({
    key: z
        .string()
        .regex(
            /^[a-z][a-zA-Z0-9]*$/,
            "must start with a lowercase letter and use letters or digits"
        ),
    description: z.string().min(1),
    type: IssueFieldTypeSchema,
    isRequired: z.boolean()
});

export type IssueField = z.infer<typeof IssueFieldSchema>;

/** Names owned by the issue format or Markdown body, never project-defined metadata. */
export const ISSUE_FIELD_RESERVED_KEYS = [
    "id",
    "title",
    "state",
    "parent",
    "assignee",
    "labels",
    "blockedBy",
    "created",
    "updated",
    "description",
    "plan",
    "notes"
] as const;

export const ConfigSchema = z
    .object({
        $schema: z.string().optional(),
        /** Display name for the project. Defaults to the containing directory's name. */
        name: z.string().min(1).optional(),
        issuesDir: z.string().min(1).default(".motte/issues"),
        states: z.array(StateSchema).min(1).default(DEFAULT_STATES),
        defaultState: z.string().min(1).optional(),
        events: EventsSchema.default({ enabled: true }),
        issueFields: z.array(IssueFieldSchema).default([])
    })
    .superRefine((config, ctx) => {
        const names = config.states.map((state) => state.name);

        const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
        if (duplicates.length > 0) {
            ctx.addIssue({
                code: "custom",
                path: ["states"],
                message: `duplicate state names: ${[...new Set(duplicates)].join(", ")}`
            });
        }

        if (config.defaultState !== undefined && !names.includes(config.defaultState)) {
            ctx.addIssue({
                code: "custom",
                path: ["defaultState"],
                message: `"${config.defaultState}" is not one of the configured states: ${names.join(", ")}`
            });
        }

        const keys = config.issueFields.map((field) => field.key);
        const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
        if (duplicateKeys.length > 0) {
            ctx.addIssue({
                code: "custom",
                path: ["issueFields"],
                message: `duplicate issue field keys: ${[...new Set(duplicateKeys)].join(", ")}`
            });
        }

        for (const [index, field] of config.issueFields.entries()) {
            if (ISSUE_FIELD_RESERVED_KEYS.includes(field.key as never)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["issueFields", index, "key"],
                    message: `"${field.key}" is reserved by the issue format`
                });
            }
        }
    });

export type RawConfig = z.infer<typeof ConfigSchema>;

/** A validated config with every optional resolved, plus where it was found. */
export interface Config {
    name: string;
    issuesDir: string;
    states: State[];
    defaultState: string;
    /** Absolute path to the directory containing `.motte.config.json`. */
    root: string;
    /** Absolute path to the config file itself. */
    configPath: string;
    /** Absolute path to the issues directory. */
    issuesPath: string;
    events: EventsConfig;
    /** Always present when loaded from disk; optional for backwards-compatible programmatic configs. */
    issueFields?: IssueField[];
}
