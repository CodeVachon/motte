import type { CommandModule } from "yargs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMotteServer } from "../mcp/server.js";
import { dim, heading } from "../ui/format.js";

/**
 * How to wire the server into an agent by hand, for anything `motte install` does not cover.
 *
 * The command is plain `motte`, which works because the installer puts it on PATH. An absolute path
 * is only needed for a binary that was placed somewhere by hand.
 */
function printConfig(): void {
    const out = process.stdout;

    out.write(
        `\n${heading("Claude Code")} ${dim("— .mcp.json in the project root, committed")}\n\n`
    );
    out.write(
        `${JSON.stringify(
            { mcpServers: { motte: { command: "motte", args: ["mcp"] } } },
            null,
            2
        )}\n`
    );

    out.write(`\n${heading("Codex CLI")} ${dim("— ~/.codex/config.toml")}\n\n`);
    out.write(`[mcp_servers.motte]\ncommand = "motte"\nargs = ["mcp"]\n`);

    out.write(
        `\n${dim("Or let motte write these for you:")}\n${dim("  motte install")}\n\n` +
            `${dim("Add --cwd if the agent will not be launched from the project root.")}\n`
    );
}

interface McpArgs {
    printConfig?: boolean;
    cwd?: string;
    agent?: string;
}

export const mcpCommand: CommandModule<{}, McpArgs> = {
    command: "mcp",
    describe: "Run the MCP server over stdio, for agents",
    builder: (yargs) =>
        yargs
            .option("print-config", {
                type: "boolean",
                describe: "Print the configuration snippet for your agent and exit"
            })
            .option("cwd", {
                type: "string",
                describe: "Project directory, if not where the server is launched"
            })
            .option("agent", {
                type: "string",
                describe: "Name recorded on notes, instead of the connecting client's name"
            }),
    handler: async (args) => {
        if (args.printConfig === true) {
            printConfig();
            return;
        }

        const server = createMotteServer({
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
            ...(args.agent === undefined ? {} : { agent: args.agent })
        });

        // Nothing may be written to stdout from here on: it is the protocol channel, and a stray
        // line of human-readable output corrupts the stream. Diagnostics go to stderr.
        await server.connect(new StdioServerTransport());
    }
};
