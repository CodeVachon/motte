/**
 * Writing motte's MCP server into agent configuration files.
 *
 * The merge and removal logic is deliberately pure — it takes the existing file contents as a string
 * and returns the new contents — so the fiddly parts are testable without touching a filesystem.
 */

export class AgentConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgentConfigError";
    }
}

export const SERVER_NAME = "motte";
export const SERVER_COMMAND = "motte";
export const SERVER_ARGS = ["mcp"];

export interface MergeResult {
    content: string;
    /** True when the file did not exist and is being created wholesale. */
    created: boolean;
    /** True when the file already had motte configured identically. */
    unchanged: boolean;
}

export interface RemoveResult {
    content: string;
    /** True when motte was the only thing in the file, so the file itself can go. */
    empty: boolean;
    /** True when motte was not configured there in the first place. */
    absent: boolean;
}

// ------------------------------------------------------- JSON config files

/**
 * Four of the five targets keep their servers in a JSON object, and differ only in which key holds them
 * and what an entry looks like inside it.
 *
 * One implementation with the differences as data, because fallow caught the alternative: writing
 * `removeFromOpencodeJson` alongside `removeFromMcpJson` produced ten identical lines whose only
 * disagreement was the string `"mcp"` versus `"mcpServers"`. Two copies of "is motte in here, and is there
 * anything else worth keeping" is two places for that judgement to drift.
 */
interface JsonShape {
    /** The object holding the servers. */
    key: string;
    /** motte's entry, in this file's shape. */
    entry: Record<string, unknown>;
    /** Written alongside the entry when motte creates the file, and never added to one it did not. */
    preamble?: Record<string, unknown>;
}

interface ServerConfig {
    [key: string]: unknown;
}

function parseConfig(existing: string, path: string): ServerConfig {
    try {
        const parsed = JSON.parse(existing) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("expected a JSON object");
        }
        return parsed as ServerConfig;
    } catch (error) {
        // Refusing beats clobbering. Overwriting a config we cannot read would destroy whatever else
        // the user had configured there.
        throw new AgentConfigError(
            `${path} could not be parsed, so it was left alone: ` +
                `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function serversIn(config: ServerConfig, key: string): Record<string, unknown> {
    const held = config[key];
    return typeof held === "object" && held !== null && !Array.isArray(held)
        ? { ...(held as Record<string, unknown>) }
        : {};
}

function emit(config: ServerConfig): string {
    return `${JSON.stringify(config, null, 2)}\n`;
}

function mergeJson(existing: string | undefined, path: string, shape: JsonShape): MergeResult {
    // An empty file is one to fill in, not one to parse: `JSON.parse("")` throws, and refusing to write
    // into a file somebody created and left blank would be unhelpful rather than careful.
    if (existing === undefined || existing.trim().length === 0) {
        return {
            content: emit({
                ...(shape.preamble ?? {}),
                [shape.key]: { [SERVER_NAME]: shape.entry }
            }),
            created: existing === undefined,
            unchanged: false
        };
    }

    const config = parseConfig(existing, path);
    const servers = serversIn(config, shape.key);

    const unchanged = JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(shape.entry);
    servers[SERVER_NAME] = shape.entry;

    return { content: emit({ ...config, [shape.key]: servers }), created: false, unchanged };
}

function removeJson(existing: string, path: string, shape: JsonShape): RemoveResult {
    const config = parseConfig(existing, path);
    const servers = serversIn(config, shape.key);

    if (!(SERVER_NAME in servers)) {
        return { content: existing, empty: false, absent: true };
    }

    delete servers[SERVER_NAME];

    // "Empty" means motte was the only thing in here — so `uninstall` may delete a file motte created.
    // Anything motte wrote itself, `$schema` included, does not count as the user's content.
    const ours = new Set([shape.key, ...Object.keys(shape.preamble ?? {})]);
    const theirs = Object.keys(config).filter((key) => !ours.has(key));

    return {
        content: emit({ ...config, [shape.key]: servers }),
        empty: Object.keys(servers).length === 0 && theirs.length === 0,
        absent: false
    };
}

/** Claude Code's `.mcp.json`, Cursor's `mcp.json`, and Gemini CLI's `settings.json`. */
const MCP_SERVERS: JsonShape = {
    key: "mcpServers",
    entry: { command: SERVER_COMMAND, args: SERVER_ARGS }
};

/**
 * opencode: servers under `mcp`, and the whole command line as one array with an explicit `type`.
 *
 * Close enough to look like the same file, different enough that reusing the `mcpServers` shape would
 * write a config opencode parses happily and then ignores — a success message and no working server.
 */
const OPENCODE: JsonShape = {
    key: "mcp",
    entry: { type: "local", command: [SERVER_COMMAND, ...SERVER_ARGS], enabled: true },
    // Its own docs lead with `$schema`, and it is what makes the file self-describing in an editor.
    preamble: { $schema: "https://opencode.ai/config.json" }
};

export function mergeMcpJson(existing: string | undefined, path = ".mcp.json"): MergeResult {
    return mergeJson(existing, path, MCP_SERVERS);
}

export function removeFromMcpJson(existing: string, path = ".mcp.json"): RemoveResult {
    return removeJson(existing, path, MCP_SERVERS);
}

export function mergeOpencodeJson(
    existing: string | undefined,
    path = "opencode.json"
): MergeResult {
    return mergeJson(existing, path, OPENCODE);
}

export function removeFromOpencodeJson(existing: string, path = "opencode.json"): RemoveResult {
    return removeJson(existing, path, OPENCODE);
}

// ------------------------------------------------------- ~/.codex/config.toml

const CODEX_SECTION = `[mcp_servers.${SERVER_NAME}]`;

function codexBlock(): string {
    return `${CODEX_SECTION}\ncommand = "${SERVER_COMMAND}"\nargs = [${SERVER_ARGS.map(
        (arg) => `"${arg}"`
    ).join(", ")}]\n`;
}

/**
 * Find our section, and where it ends.
 *
 * A targeted edit rather than a TOML round-trip: parsing and re-emitting the whole file would lose
 * the user's comments and formatting, and pulling in a TOML library to do it properly is a lot of
 * dependency for one section.
 */
function findCodexSection(lines: string[]): { start: number; end: number } | undefined {
    const start = lines.findIndex((line) => line.trim() === CODEX_SECTION);
    if (start === -1) return undefined;

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
        // Any other table header at the start of a line ends our section.
        if (/^\s*\[/.test(lines[i]!)) {
            end = i;
            break;
        }
    }

    return { start, end };
}

export function mergeCodexToml(existing: string | undefined): MergeResult {
    if (existing === undefined || existing.trim().length === 0) {
        return { content: codexBlock(), created: existing === undefined, unchanged: false };
    }

    const lines = existing.split("\n");
    const found = findCodexSection(lines);

    if (found === undefined) {
        const separator = existing.endsWith("\n") ? "" : "\n";
        return {
            content: `${existing}${separator}\n${codexBlock()}`,
            created: false,
            unchanged: false
        };
    }

    const current = lines.slice(found.start, found.end).join("\n").trim();
    if (current === codexBlock().trim()) {
        return { content: existing, created: false, unchanged: true };
    }

    const replaced = [...lines.slice(0, found.start), ...codexBlock().split("\n").slice(0, -1)];
    replaced.push(...lines.slice(found.end));

    return { content: replaced.join("\n"), created: false, unchanged: false };
}

export function removeFromCodexToml(existing: string): RemoveResult {
    const lines = existing.split("\n");
    const found = findCodexSection(lines);

    if (found === undefined) return { content: existing, empty: false, absent: true };

    const remaining = [...lines.slice(0, found.start), ...lines.slice(found.end)];
    const content = remaining
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimStart();

    return { content, empty: content.trim().length === 0, absent: false };
}
