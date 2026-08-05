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
} from "./agents.js";
import { AGENTS_FILENAME, hasBrokenMarkers, mergeAgentsMd } from "./instructions.js";
import { rememberWiring, type AgentId, type Scope } from "./record.js";

/**
 * What wiring an agent up actually consists of, shared by `motte install` and `motte init`.
 *
 * Extracted from the install command, which owned all of it inline. `init` needs the same behaviour —
 * #0020 always said it would offer this — and the alternative was a second copy of the detection, which
 * would have drifted the first time a target was added.
 *
 * Each action is a description plus an `apply`, so a dry run can print exactly what a real run would do
 * rather than approximating it.
 */

export function home(): string {
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
    { id: "claude-code", label: "Claude Code", detected: claudeCodePresent },
    { id: "codex", label: "Codex CLI", detected: codexPresent }
];

export interface ApplyOutcome {
    changed: boolean;
    created: boolean;
    detail?: string;
}

export interface Action {
    agent: AgentId;
    label: string;
    scope: Scope;
    path?: string;
    /** Written by another tool because it owns the file's schema. */
    delegated?: string[];
    apply: () => ApplyOutcome;
}

/**
 * The project to wire, or undefined if there is none.
 *
 * An explicit root matters: `motte init <dir>` scaffolds somewhere other than the working directory, and
 * discovery walks up from the working directory — so without this, initialising a sibling project would
 * wire up whichever project the shell happened to be sitting in.
 */
function resolveRoot(explicit: string | undefined): string | undefined {
    if (explicit !== undefined) return explicit;

    const config = findConfigFile();
    return config === undefined ? undefined : dirname(config);
}

function requireRoot(explicit: string | undefined): string {
    const root = resolveRoot(explicit);
    if (root === undefined) {
        throw new AgentConfigError(
            "no motte project was found here, so there is nothing to wire an agent up to. " +
                "Run `motte init` first, or pass --scope user."
        );
    }
    return root;
}

/** Write `content` to `path`, creating any missing directories. */
function put(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}

function read(path: string): string | undefined {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function mcpJsonAction(label: string, root: string): Action {
    const path = join(root, ".mcp.json");

    return {
        agent: "claude-code",
        label,
        scope: "project",
        path,
        apply: () => {
            const merged = mergeMcpJson(read(path), path);
            if (!merged.unchanged) put(path, merged.content);

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
            const merged = mergeCodexToml(read(path));
            if (!merged.unchanged) put(path, merged.content);

            return { changed: !merged.unchanged, created: merged.created };
        }
    };
}

/**
 * The AGENTS.md block.
 *
 * Not tied to one agent: both supported agents read this file, and the instructions are about the
 * project rather than about any tool. It is a project file, so it is only ever written when there is a
 * project to write it in.
 */
function instructionsAction(root: string): Action {
    const path = join(root, AGENTS_FILENAME);

    return {
        agent: "agents-md",
        label: "Agent instructions",
        scope: "project",
        path,
        apply: () => {
            const existing = read(path);

            if (existing !== undefined && hasBrokenMarkers(existing)) {
                throw new AgentConfigError(
                    `${path} has a motte start marker with no matching end marker, so it was left ` +
                        `alone. Repair or delete the markers and run this again.`
                );
            }

            const merged = mergeAgentsMd(existing);
            if (!merged.unchanged) put(path, merged.content);

            return { changed: !merged.unchanged, created: merged.created };
        }
    };
}

export interface PlanOptions {
    scope: Scope;
    /** Only this agent. Undefined means every detected one. */
    agent?: string | undefined;
    /** Skip the AGENTS.md block. */
    withoutInstructions?: boolean;
    /** The project to write into. Undefined discovers one by walking up from the working directory. */
    root?: string | undefined;
}

export interface WiringPlan {
    actions: Action[];
}

/**
 * Work out what to write.
 *
 * An explicitly named `--agent` is taken at face value rather than detected: asking for something that
 * is not installed yet is a reasonable thing to do when setting a machine up.
 */
export function planWiring(options: PlanOptions): WiringPlan {
    const wanted = TARGETS.filter(
        (target) => options.agent === undefined || target.id === options.agent
    );
    const present = wanted.filter((target) => options.agent !== undefined || target.detected());
    const actions: Action[] = [];

    for (const target of present) {
        if (target.id === "codex") {
            actions.push(codexAction(target.label));
            continue;
        }
        actions.push(
            options.scope === "project"
                ? mcpJsonAction(target.label, requireRoot(options.root))
                : claudeDelegatedAction(target.label, options.scope)
        );
    }

    // Instructions are worth leaving even when no agent is configured here — an agent may be wired up at
    // user scope, or on somebody else's clone of this repository.
    const root = resolveRoot(options.root);
    if (options.withoutInstructions !== true && root !== undefined) {
        actions.push(instructionsAction(root));
    }

    return { actions };
}

export interface WiringResult {
    agent: AgentId;
    label: string;
    scope: Scope;
    changed: boolean;
    path?: string;
    detail?: string;
}

/** Apply one action and record it, so `motte uninstall` can reverse exactly what was written. */
export function applyAction(action: Action): WiringResult {
    const outcome = action.apply();

    rememberWiring({
        agent: action.agent,
        scope: action.scope,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(outcome.created ? { createdFile: true } : {}),
        ...(action.delegated === undefined ? {} : { delegated: true })
    });

    return {
        agent: action.agent,
        label: action.label,
        scope: action.scope,
        changed: outcome.changed,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail })
    };
}
