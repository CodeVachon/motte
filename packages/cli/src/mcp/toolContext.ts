import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigNotFoundError, IssueStore, loadConfig, type Author, type Config } from "@motte/core";
import { failure, type ToolResult } from "./shape.js";

const NO_PROJECT =
    "No motte project was found in this directory or any parent. " +
    "Run `motte init` in the project root, or start the server with --cwd pointing at it.";

export interface ServerOptions {
    /** Where to look for the project. Defaults to the process working directory. */
    cwd?: string;
    /** Overrides the agent name recorded on notes. */
    agent?: string;
}

/**
 * What every tool needs: a way into the project, the agent's identity, and a uniform error boundary.
 *
 * These were closures inside `createMotteServer`, which is why that function reached 525 lines — every
 * tool had to live in the same scope to see them. Passing them explicitly lets the tools move out.
 */
export interface ToolContext {
    open(): { config: Config; store: IssueStore };
    author(): Author;
    guard<A>(handler: (args: A) => ToolResult): (args: A) => ToolResult;
}

export function toolContext(server: McpServer, options: ServerOptions): ToolContext {
    const cwd = options.cwd ?? process.cwd();

    /**
     * The agent's identity, used both for authored notes and for recorded transitions.
     *
     * Prefers the client's own name from the MCP handshake, so notes say "claude-code" rather than a
     * generic label, and falls back to MOTTE_AGENT or an explicit override. Resolved per call because
     * the handshake has not happened yet when the server is constructed.
     */
    const agentName = (): string =>
        options.agent ??
        process.env.MOTTE_AGENT ??
        server.server.getClientVersion()?.name ??
        "agent";

    const author = (): Author => ({ name: agentName(), type: "agent" as const });

    return {
        author,

        /**
         * Resolve the project per call rather than at startup.
         *
         * A server that fails to start shows up in the client as broken with no explanation. One that
         * starts and reports a missing project as a tool error tells the agent what to do about it.
         */
        open: () => {
            const config = loadConfig(cwd);
            // The author is handed to the store, not just used for notes, so recorded transitions are
            // attributed to the agent too — otherwise the log would credit every agent action to the
            // git user and the whole point of distinguishing them would be lost.
            return { config, store: new IssueStore(config, author()) };
        },

        /** Every tool body runs through here, so a missing project or a bad ref never crashes the server. */
        guard:
            <A>(handler: (args: A) => ToolResult) =>
            (args: A): ToolResult => {
                try {
                    return handler(args);
                } catch (thrown) {
                    if (thrown instanceof ConfigNotFoundError) return failure(NO_PROJECT);
                    return failure(thrown instanceof Error ? thrown.message : String(thrown));
                }
            }
    };
}

export { NO_PROJECT };
