import type { CommandModule } from "yargs";
import { relative } from "node:path";
import {
    AGENT_IDS,
    applyAction,
    detectionSummary,
    planWiring,
    type WiringResult
} from "../install/wiring.js";
import type { Scope } from "../install/record.js";
import { emitJson } from "../context.js";
import { dim, ok, warn } from "../ui/format.js";

/**
 * Wiring, as a command. The work itself lives in `install/wiring.ts`, because `motte init` does the same
 * thing and a second copy of the detection would have drifted the first time a target was added.
 */

interface InstallArgs {
    agent?: string;
    scope?: string;
    instructions?: boolean;
    hooks?: boolean;
    dryRun?: boolean;
    json?: boolean;
}

export const installCommand: CommandModule<{}, InstallArgs> = {
    command: "install",
    describe: "Wire motte's MCP server into the agents on this machine",
    builder: (yargs) =>
        yargs
            .option("agent", {
                type: "string",
                choices: AGENT_IDS,
                describe: "Only this agent (default: every one detected)"
            })
            .option("scope", {
                type: "string",
                choices: ["project", "user", "local"],
                default: "project",
                describe: "project writes config you can commit; user applies everywhere"
            })
            .option("instructions", {
                type: "boolean",
                default: true,
                describe: `Also write motte's section of AGENTS.md (--no-instructions to skip)`
            })
            .option("hooks", {
                type: "boolean",
                describe: "Also install a prepare-commit-msg hook that stamps the issue you claimed"
            })
            .option("dry-run", { type: "boolean", describe: "Show what would be written" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const scope = (args.scope ?? "project") as Scope;
        const plan = planWiring({
            scope,
            agent: args.agent,
            withoutInstructions: args.instructions === false,
            withHooks: args.hooks === true
        });

        if (plan.actions.length === 0) {
            process.stdout.write(
                `${warn("no supported agent was detected on this machine")}\n` +
                    `${dim(`  Looked for ${detectionSummary()}.`)}\n` +
                    `${dim("  Pass --agent to wire one up anyway, or use `motte mcp --print-config`.")}\n`
            );
            return;
        }

        if (args.dryRun === true) {
            if (args.json === true) {
                emitJson({
                    scope,
                    actions: plan.actions.map((action) => ({
                        agent: action.agent,
                        scope: action.scope,
                        path: action.path ?? null,
                        delegatedTo: action.delegated ?? null
                    }))
                });
                return;
            }

            process.stdout.write(`\n${dim("would write:")}\n`);
            for (const action of plan.actions) {
                process.stdout.write(
                    `  ${action.label} ${dim(`(${action.scope})`)}  ` +
                        `${action.path ?? dim(`via ${action.delegated?.join(" ")}`)}\n`
                );
            }
            process.stdout.write("\n");
            return;
        }

        const results: WiringResult[] = [];

        for (const action of plan.actions) {
            const result = applyAction(action);
            results.push(result);

            if (args.json !== true) {
                const where = result.path ?? result.detail ?? "";
                process.stdout.write(
                    result.changed
                        ? `${ok(`${action.label} → ${where}`)}\n`
                        : `${ok(`${action.label} already configured`)} ${dim(where)}\n`
                );
            }
        }

        /**
         * The project files worth committing, so the advice matches what was written.
         *
         * Only project scope, and only files inside the project: a user-scope config describes one machine,
         * and `.git/hooks` is not tracked, so neither can be committed by anybody.
         */
        const committable = results
            .filter((result) => result.scope === "project" && result.agent !== "git-hook")
            .map((result) =>
                result.path === undefined ? undefined : relative(process.cwd(), result.path)
            )
            .filter((path): path is string => path !== undefined && !path.startsWith(".."));

        if (args.json === true) {
            emitJson({
                scope,
                wired: results.map((result) => ({
                    agent: result.agent,
                    scope: result.scope,
                    changed: result.changed,
                    ...(result.path === undefined ? {} : { path: result.path })
                }))
            });
            return;
        }

        process.stdout.write(
            `\n${dim("Restart the agent to pick this up.")}\n` +
                // Named from what was actually written. It used to say ".mcp.json and AGENTS.md" whatever
                // happened, which became wrong as soon as there were targets with other config files:
                // installing for Cursor and opencode alone advised committing a file that did not exist.
                (committable.length > 0
                    ? `${dim(`Commit ${committable.join(", ")} so everyone working here gets the same wiring.`)}\n`
                    : "")
        );
    }
};
