import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../version.js";
import { toolContext, type ServerOptions } from "./toolContext.js";
import { registerReadTools } from "./tools/reads.js";
import { registerWriteTools } from "./tools/writes.js";
import { registerBreakdownTool } from "./tools/breakdown.js";

/**
 * How an agent is expected to use this. Sent to the client on initialize, so it shapes behaviour
 * before any tool is called.
 */
const INSTRUCTIONS = `motte tracks issues as committed Markdown files, so the record is shared with
whoever else works in this repository — including the humans.

Start with next_issue. It returns the issue to pick up and why — what it unblocks, how close it is to a
leaf, how long it has waited — and it leaves out anything another agent holds. ready_issues gives the whole
set in id order if you want to see it, but choosing from that yourself means choosing arbitrarily.

For any issue you take on:

1. claim_issue before anything else. If it fails, another agent is on that issue: ask next_issue again
   and take something else rather than working on it anyway.
2. get_issue to read it, including its plan and prior notes
3. If the plan on the file is not what you are actually going to do, update_issue to correct it first
4. add_note as you go — decisions, dead ends, and anything the next person would otherwise have to
   rediscover. Notes are cheap and they are the main reason this record is worth keeping.
5. set_state to the completed state only once the work is actually verified
6. release_issue if you abandon it, so it does not sit looking like work in progress

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

export type { ServerOptions };
