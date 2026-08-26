import type { CommandModule } from "yargs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { CONFIG_FILENAME, DEFAULT_STATES } from "@motte/core";
import { context } from "../context.js";
import { AgentConfigError } from "../install/agents.js";
import type { AgentId } from "../install/record.js";
import { AGENT_IDS, agentTargets, applyAction, home, planWiring } from "../install/wiring.js";
import { chooseAgentTargets } from "../ui/agentSelector.js";
import { dim, ok, warn } from "../ui/format.js";

const SCHEMA_URL = "https://codevachon.github.io/motte/schema/config.json";

interface InitArgs {
    dir?: string;
    name?: string;
    force?: boolean;
    agents?: boolean;
    agent?: string[];
}

/**
 * Wire up whatever agents are here, and leave them instructions.
 *
 * Part of `init` rather than something to remember afterwards: a backlog no agent can see is a backlog
 * that gets ignored, and the hint to go and run `motte install` was only read by people who did not need
 * it. The work is `install`'s, called directly, so the two cannot disagree.
 *
 * Failures are reported and swallowed. The project has been created by this point, and an agent config
 * motte could not parse is a reason to say so — not to fail the command that scaffolded the project.
 */
/**
 * A path a reader can place at a glance: relative inside the project, `~`-prefixed outside it.
 *
 * Some of what gets written is user-scoped — Codex keeps its config in the home directory — and
 * relativising that against the project produced `../../../tmp/…/.codex/config.toml`.
 */
function displayPath(root: string, path: string): string {
    const inside = relative(root, path);
    if (!inside.startsWith("..")) return inside;

    const dir = home();
    return path.startsWith(dir) ? `~${path.slice(dir.length)}` : path;
}

function isInteractive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function selectedAgents(args: InitArgs): Promise<AgentId[] | null | undefined> {
    if (args.agent !== undefined) return args.agent as AgentId[];
    if (!isInteractive()) return undefined;
    return chooseAgentTargets(agentTargets());
}

function wireAgents(root: string, agents: AgentId[] | undefined): void {
    const out = process.stdout;

    try {
        // The root is passed rather than discovered: `motte init <dir>` may be scaffolding somewhere
        // other than the working directory.
        const plan = planWiring({
            scope: "project",
            root,
            ...(agents === undefined ? {} : { agents })
        });

        for (const action of plan.actions) {
            const result = applyAction(action);
            const where =
                result.path === undefined ? (result.detail ?? "") : displayPath(root, result.path);

            out.write(
                result.changed
                    ? `${ok(`${action.label} → ${where}`)}\n`
                    : `${ok(`${action.label} already configured`)} ${dim(where)}\n`
            );
        }

        // The instructions are written whether or not an agent was found, so this is how "nothing was
        // detected" looks. Worth saying, because the absence is otherwise indistinguishable from success.
        if (agents?.length === 0) {
            out.write(
                `${dim("  No agent integrations selected; wrote the shared AGENTS.md guidance.")}\n`
            );
        } else if (plan.actions.every((action) => action.agent === "agents-md")) {
            out.write(
                `${dim("  No agent detected here — `motte install --agent claude-code` wires one up anyway.")}\n`
            );
        }
    } catch (error) {
        process.stderr.write(
            `${warn(
                error instanceof AgentConfigError
                    ? error.message
                    : `could not wire up agents: ${error instanceof Error ? error.message : String(error)}`
            )}\n` +
                `${dim("  The project is set up. Run `motte install` to try the wiring again.")}\n`
        );
    }
}

export const initCommand: CommandModule<{}, InitArgs> = {
    command: "init [dir]",
    describe: `Create ${CONFIG_FILENAME}, the issues directory, and the agent wiring`,
    builder: (yargs) =>
        yargs
            .positional("dir", { type: "string", describe: "Project directory (defaults to cwd)" })
            .option("name", { type: "string", describe: "Project name" })
            .option("force", { type: "boolean", describe: "Overwrite an existing config" })
            .option("agents", {
                type: "boolean",
                default: true,
                describe: "Wire up detected agents and write AGENTS.md (--no-agents to skip)"
            })
            .option("agent", {
                type: "array",
                string: true,
                choices: AGENT_IDS,
                describe: "Agent to wire (repeatable; skips the interactive selector)"
            }),
    handler: async (args) => {
        const root = resolve(args.dir ?? process.cwd());
        const configPath = join(root, CONFIG_FILENAME);

        if (existsSync(configPath) && args.force !== true) {
            process.stderr.write(
                `${warn(`${configPath} already exists. Pass --force to overwrite it.`)}\n`
            );
            process.exitCode = 1;
            return;
        }

        if (args.agents === false && args.agent !== undefined) {
            throw new AgentConfigError("--agent cannot be used with --no-agents");
        }

        const issuesDir = ".motte/issues";
        const config = {
            $schema: SCHEMA_URL,
            name: args.name ?? basename(root),
            issuesDir,
            defaultState: DEFAULT_STATES[0]!.name,
            states: DEFAULT_STATES
        };

        mkdirSync(join(root, issuesDir), { recursive: true });
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

        const out = process.stdout;
        out.write(`${ok(`wrote ${CONFIG_FILENAME}`)}\n`);
        out.write(`${ok(`created ${issuesDir}/`)}\n`);

        // After the config exists, because the wiring finds the project the same way every other command
        // does — by looking for that file.
        if (args.agents !== false) {
            const selected = await selectedAgents(args);
            if (selected === null) {
                out.write(`${dim("Agent setup cancelled; the project itself is ready.")}\n`);
            } else {
                wireAgents(root, selected);
            }
        }

        // Opening the project it just created is also what registers it, so `motte projects` knows about a
        // project from the moment it exists rather than from the next command run inside it.
        try {
            context(root);
        } catch {
            // The config was just written, so this should not fail — and if it does, the project is still
            // set up and `doctor` is the command that should say why.
        }

        out.write(
            `\n${dim("Commit all of it — the backlog is meant to travel with the code.")}\n` +
                `${dim('Next: `motte add "your first issue"`.')}\n`
        );
    }
};
