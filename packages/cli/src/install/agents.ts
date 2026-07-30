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

// ------------------------------------------------------------------ .mcp.json

interface McpJson {
    mcpServers?: Record<string, unknown>;
    [key: string]: unknown;
}

function parseMcpJson(existing: string, path: string): McpJson {
    try {
        const parsed = JSON.parse(existing) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("expected a JSON object");
        }
        return parsed as McpJson;
    } catch (error) {
        // Refusing beats clobbering. Overwriting a config we cannot read would destroy whatever else
        // the user had configured there.
        throw new AgentConfigError(
            `${path} could not be parsed, so it was left alone: ` +
                `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function mergeMcpJson(existing: string | undefined, path = ".mcp.json"): MergeResult {
    const entry = { command: SERVER_COMMAND, args: SERVER_ARGS };

    if (existing === undefined) {
        return {
            content: `${JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2)}\n`,
            created: true,
            unchanged: false
        };
    }

    const config = parseMcpJson(existing, path);
    const servers = { ...(config.mcpServers ?? {}) };

    const unchanged = JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry);
    servers[SERVER_NAME] = entry;

    return {
        content: `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`,
        created: false,
        unchanged
    };
}

export function removeFromMcpJson(existing: string, path = ".mcp.json"): RemoveResult {
    const config = parseMcpJson(existing, path);
    const servers = { ...(config.mcpServers ?? {}) };

    if (!(SERVER_NAME in servers)) {
        return { content: existing, empty: false, absent: true };
    }

    delete servers[SERVER_NAME];

    // Only "empty" if motte was the sole server and there is nothing else in the file worth keeping.
    const otherKeys = Object.keys(config).filter((key) => key !== "mcpServers");
    const empty = Object.keys(servers).length === 0 && otherKeys.length === 0;

    return {
        content: `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`,
        empty,
        absent: false
    };
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
