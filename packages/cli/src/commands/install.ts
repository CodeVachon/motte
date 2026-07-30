import type { CommandModule } from "yargs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findConfigFile } from "@motte/core";
import {
    AgentConfigError,
    SERVER_ARGS,
    SERVER_COMMAND,
    SERVER_NAME,
    mergeCodexToml,
    mergeMcpJson
} from "../install/agents.js";
import { rememberWiring, type AgentId, type Scope } from "../install/record.js";
import { emitJson } from "../context.js";
import { dim, ok, warn } from "../ui/format.js";

function home(): string {
    return process.env.HOME ?? process.env.USERPROFILE ?? ".";
}

interface Target {
    id: AgentId;
    label: string;
    /** Whether this agent looks present on the machine. */
    detected: () => boolean;
}

function claudeCodePresent(): boolean {
    return (
        existsSync(join(home(), ".claude")) ||
        existsSync(join(home(), ".claude.json")) ||
        spawnSync("command", ["-v", "claude"], { shell: true }).status === 0
    );
}

function codexPresent(): boolean {
    return (
        existsSync(join(home(), ".codex")) ||
        spawnSync("command", ["-v", "codex"], { shell: true }).status === 0
    );
}

const TARGETS: Target[] = [
    {
        id: "claude-code",
        label: "Claude Code",
        detected: claudeCodePresent
    },
    {
        id: "codex",
        label: "Codex CLI",
        detected: codexPresent
    }
];

interface Action {
    agent: AgentId;
    label: string;
    scope: Scope;
    path?: string;
    /** Written by another tool because it owns the file's schema. */
    delegated?: string[];
    apply: () => { changed: boolean; created: boolean; detail?: string };
}

function projectRoot(): string {
    const config = findConfigFile();
    if (config === undefined) {
        throw new AgentConfigError(
            "no motte project was found here, so there is nothing to wire an agent up to. " +
                "Run `motte init` first, or pass --scope user."
        );
    }
    return dirname(config);
}

function mcpJsonAction(label: string): Action {
    const path = join(projectRoot(), ".mcp.json");

    return {
        agent: "claude-code",
        label,
        scope: "project",
        path,
        apply: () => {
            const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
            const merged = mergeMcpJson(existing, path);

            if (!merged.unchanged) {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, merged.content, "utf8");
            }

            return { changed: !merged.unchanged, created: merged.created };
        }
    };
}

/**
 * Claude Code's user-scope config lives in `~/.claude.json`, alongside a lot of other state whose
 * schema is Claude Code's business rather than ours. Delegating to its own CLI means motte never has
 * to guess at that shape — at the cost of not being able to reverse it in `motte uninstall`.
 */
function claudeDelegatedAction(label: string, scope: Scope): Action {
    const argv = [
        "mcp",
        "add",
        "--scope",
        scope,
        SERVER_NAME,
        "--",
        SERVER_COMMAND,
        ...SERVER_ARGS
    ];

    return {
        agent: "claude-code",
        label,
        scope,
        delegated: ["claude", ...argv],
        apply: () => {
            const result = spawnSync("claude", argv, { encoding: "utf8" });

            if (result.error !== undefined) {
                throw new AgentConfigError(
                    `could not run the claude CLI, which owns ~/.claude.json: ${result.error.message}`
                );
            }
            if (result.status !== 0) {
                throw new AgentConfigError(
                    `claude mcp add exited with ${result.status}: ` +
                        `${(result.stderr || result.stdout || "").trim()}`
                );
            }

            return { changed: true, created: false, detail: `claude ${argv.join(" ")}` };
        }
    };
}

function codexAction(label: string): Action {
    const path = join(home(), ".codex", "config.toml");

    return {
        agent: "codex",
        label,
        scope: "user",
        path,
        apply: () => {
            const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
            const merged = mergeCodexToml(existing);

            if (!merged.unchanged) {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, merged.content, "utf8");
            }

            return { changed: !merged.unchanged, created: merged.created };
        }
    };
}

interface InstallArgs {
    agent?: string;
    scope?: string;
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
                choices: ["claude-code", "codex"],
                describe: "Only this agent (default: every one detected)"
            })
            .option("scope", {
                type: "string",
                choices: ["project", "user", "local"],
                default: "project",
                describe: "project writes a committed .mcp.json; user applies everywhere"
            })
            .option("dry-run", { type: "boolean", describe: "Show what would be written" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const scope = (args.scope ?? "project") as Scope;
        const wanted = TARGETS.filter(
            (target) => args.agent === undefined || target.id === args.agent
        );

        const present = wanted.filter((target) => args.agent !== undefined || target.detected());

        if (present.length === 0) {
            process.stdout.write(
                `${warn("no supported agent was detected on this machine")}\n` +
                    `${dim("  Looked for Claude Code (~/.claude) and Codex CLI (~/.codex).")}\n` +
                    `${dim("  Pass --agent to wire one up anyway, or use `motte mcp --print-config`.")}\n`
            );
            return;
        }

        const actions: Action[] = present.map((target) => {
            if (target.id === "codex") return codexAction(target.label);
            return scope === "project"
                ? mcpJsonAction(target.label)
                : claudeDelegatedAction(target.label, scope);
        });

        if (args.dryRun === true) {
            if (args.json === true) {
                emitJson({
                    scope,
                    actions: actions.map((action) => ({
                        agent: action.agent,
                        scope: action.scope,
                        path: action.path ?? null,
                        delegatedTo: action.delegated ?? null
                    }))
                });
                return;
            }

            process.stdout.write(`\n${dim("would write:")}\n`);
            for (const action of actions) {
                process.stdout.write(
                    `  ${action.label} ${dim(`(${action.scope})`)}  ` +
                        `${action.path ?? dim(`via ${action.delegated?.join(" ")}`)}\n`
                );
            }
            process.stdout.write("\n");
            return;
        }

        const results: { agent: AgentId; scope: Scope; changed: boolean; path?: string }[] = [];

        for (const action of actions) {
            const outcome = action.apply();

            rememberWiring({
                agent: action.agent,
                scope: action.scope,
                ...(action.path === undefined ? {} : { path: action.path }),
                ...(outcome.created ? { createdFile: true } : {}),
                ...(action.delegated === undefined ? {} : { delegated: true })
            });

            results.push({
                agent: action.agent,
                scope: action.scope,
                changed: outcome.changed,
                ...(action.path === undefined ? {} : { path: action.path })
            });

            if (args.json !== true) {
                const where = action.path ?? outcome.detail ?? "";
                process.stdout.write(
                    outcome.changed
                        ? `${ok(`${action.label} → ${where}`)}\n`
                        : `${ok(`${action.label} already configured`)} ${dim(where)}\n`
                );
            }
        }

        if (args.json === true) {
            emitJson({ scope, wired: results });
            return;
        }

        process.stdout.write(
            `\n${dim("Restart the agent to pick this up.")}\n` +
                (scope === "project"
                    ? `${dim("Commit .mcp.json so everyone working here gets the same wiring.")}\n`
                    : "")
        );
    }
};
