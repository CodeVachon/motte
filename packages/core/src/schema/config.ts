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

export const ConfigSchema = z
    .object({
        $schema: z.string().optional(),
        /** Display name for the project. Defaults to the containing directory's name. */
        name: z.string().min(1).optional(),
        issuesDir: z.string().min(1).default(".motte/issues"),
        states: z.array(StateSchema).min(1).default(DEFAULT_STATES),
        defaultState: z.string().min(1).optional()
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
}
