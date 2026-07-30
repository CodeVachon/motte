import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../version.js";
import { toolContext, NO_PROJECT, type ServerOptions } from "./toolContext.js";
import { registerReadTools } from "./tools/reads.js";
import { registerWriteTools } from "./tools/writes.js";
import { registerBreakdownTool } from "./tools/breakdown.js";

/**
 * How an agent is expected to use this. Sent to the client on initialize, so it shapes behaviour
 * before any tool is called.
 */
const INSTRUCTIONS = `motte tracks issues as committed Markdown files, so the record is shared with
whoever else works in this repository — including the humans.

Start with ready_issues, not list_issues. "Ready" means unsettled with every blocker settled; work that
is still blocked cannot be started, and picking it up anyway wastes effort.

For any issue you take on:

1. get_issue to read it, including its plan and prior notes
2. If the plan on the file is not what you are actually going to do, update_issue to correct it first
3. set_state to the started state
4. add_note as you go — decisions, dead ends, and anything the next person would otherwise have to
   rediscover. Notes are cheap and they are the main reason this record is worth keeping.
5. set_state to the completed state only once the work is actually verified

Use breakdown to split a large issue into children, rather than creating them one at a time.

If you discover that one issue depends on another, record it with set_blockers rather than describing
it in prose. Prose is not queryable, and ready_issues is what the next agent reads.

Notes you write are attributed to you as an agent. Notes written by a person through the CLI are
attributed to them. Both land in the same file.`;

/**
 * Assemble the server.
 *
 * Registration only. This was a single 525-line function holding all twelve tools, because the helpers
 * they share were closures in its scope; those now live in `toolContext`, so each group of tools is its
 * own module.
 */
export function createMotteServer(options: ServerOptions = {}): McpServer {
    const server = new McpServer(
        { name: "motte", version: VERSION },
        { instructions: INSTRUCTIONS }
    );

    const tools = toolContext(server, options);

    registerReadTools(server, tools);
    registerBreakdownTool(server, tools);
    registerWriteTools(server, tools);

    return server;
}

export { INSTRUCTIONS, NO_PROJECT, type ServerOptions };
