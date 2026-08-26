import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { ConfigSchema, DEFAULT_STATES, type Config, type State } from "./schema/config.js";

export type { Config, State } from "./schema/config.js";

export const CONFIG_FILENAME = ".motte.config.json";

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

export class ConfigNotFoundError extends ConfigError {
    constructor(readonly from: string) {
        super(
            `no ${CONFIG_FILENAME} found in ${from} or any parent directory. ` +
                `Run \`motte init\` to create one.`
        );
        this.name = "ConfigNotFoundError";
    }
}

/**
 * Walk up from `from` looking for the config file, the way git finds `.git`. This is what lets
 * commands work from any subdirectory of a project.
 */
export function findConfigFile(from: string = process.cwd()): string | undefined {
    let current = resolve(from);
    const { root } = parse(current);

    for (;;) {
        const candidate = join(current, CONFIG_FILENAME);
        if (existsSync(candidate)) return candidate;
        if (current === root) return undefined;
        current = dirname(current);
    }
}

export function loadConfigFrom(configPath: string): Config {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
        throw new ConfigError(
            `${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
        throw new ConfigError(`${configPath} is invalid — ${detail}`);
    }

    const root = dirname(configPath);
    const states: State[] = parsed.data.states.length > 0 ? parsed.data.states : DEFAULT_STATES;

    return {
        name: parsed.data.name ?? basename(root),
        issuesDir: parsed.data.issuesDir,
        states,
        // Falling back to the first configured state means a project that omits `defaultState`
        // still behaves sensibly, and reordering `states` moves the default with it.
        defaultState: parsed.data.defaultState ?? states[0]!.name,
        root,
        configPath,
        issuesPath: isAbsolute(parsed.data.issuesDir)
            ? parsed.data.issuesDir
            : join(root, parsed.data.issuesDir),
        events: parsed.data.events,
        issueFields: parsed.data.issueFields
    };
}

export function loadConfig(from: string = process.cwd()): Config {
    const configPath = findConfigFile(from);
    if (configPath === undefined) throw new ConfigNotFoundError(resolve(from));
    return loadConfigFrom(configPath);
}

/**
 * Match a state by name, case-insensitively, then by unique prefix. Lets `motte move 42 done`
 * and `motte move 42 "in prog"` both work.
 */
export function resolveState(config: Config, input: string): State {
    const needle = input.trim().toLowerCase();

    const exact = config.states.find((state) => state.name.toLowerCase() === needle);
    if (exact) return exact;

    const prefixed = config.states.filter((state) => state.name.toLowerCase().startsWith(needle));
    if (prefixed.length === 1) return prefixed[0]!;

    const names = config.states.map((state) => state.name).join(", ");
    if (prefixed.length > 1) {
        throw new ConfigError(
            `"${input}" matches more than one state: ${prefixed.map((s) => s.name).join(", ")}`
        );
    }
    throw new ConfigError(`"${input}" is not a known state. Configured states: ${names}`);
}

export function stateCategory(config: Config, stateName: string): State["category"] | undefined {
    return config.states.find((state) => state.name === stateName)?.category;
}
