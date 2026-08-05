import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findConfigFile } from "@motte/core";
import {
    AgentConfigError,
    SERVER_ARGS,
    SERVER_COMMAND,
    SERVER_NAME,
    mergeCodexToml,
    mergeMcpJson,
    mergeOpencodeJson,
    type MergeResult
} from "./agents.js";
import { AGENTS_FILENAME, AGENTS_MARKERS, mergeAgentsMd } from "./instructions.js";
import { HOOK_MARKERS, HOOK_NAME, mergeHook } from "./hooks.js";
import { hasBrokenMarkers } from "./markedBlock.js";
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

/**
 * One descriptor per agent: where its config lives, and how motte's entry goes into it.
 *
 * Data rather than branches. `planWiring` used to switch on the agent id, which was fine for two targets
 * and would have been three more branches for Cursor, Gemini CLI and opencode — each of which differs only
 * in a path and a merge function. Claude Code is still the exception, and says so.
 */
interface Target {
    id: AgentId;
    label: string;
    /** Whether this agent looks present on the machine. */
    detected: () => boolean;
    /**
     * Where this agent reads config for a given scope, or undefined if it has none.
     *
     * `root` is the project being wired, and is only passed for project scope.
     */
    config: (scope: Scope, root: () => string) => string | undefined;
    /** Merge motte's entry into the file's existing contents. */
    merge: (existing: string | undefined, path: string) => MergeResult;
}

/** Looks present if its config directory exists, or its command is on the PATH. */
function presence(...names: string[]): () => boolean {
    return () =>
        names.some(
            (name) =>
                existsSync(join(home(), name)) ||
                // Only the last segment is a command name — `.config/opencode` is a directory, `opencode` is
                // the binary. Checking the PATH catches a fresh install that has never written any config.
                spawnSync("command", ["-v", name.split("/").pop()!], { shell: true }).status === 0
        );
}

/**
 * Agents whose config is one JSON file per scope, holding `mcpServers`.
 *
 * Cursor, Gemini CLI and Claude Code's project file all take the identical shape, which is why one merge
 * function serves them. Gemini's file holds the rest of its settings too, and `mergeMcpJson` preserves
 * every other top-level key for exactly that reason.
 */
function jsonAt(user: string, project: string): Target["config"] {
    return (scope, root) => (scope === "project" ? join(root(), project) : join(home(), user));
}

const TARGETS: Target[] = [
    {
        id: "claude-code",
        label: "Claude Code",
        detected: presence(".claude", ".claude.json"),
        // Project only. `~/.claude.json` holds a great deal of Claude Code's own state, so user scope is
        // delegated to its CLI instead — see `claudeDelegatedAction`.
        config: (scope, root) => (scope === "project" ? join(root(), ".mcp.json") : undefined),
        merge: mergeMcpJson
    },
    {
        id: "codex",
        label: "Codex CLI",
        detected: presence(".codex"),
        // One global TOML, whatever scope was asked for: Codex has no per-project config to write into.
        config: () => join(home(), ".codex", "config.toml"),
        merge: (existing) => mergeCodexToml(existing)
    },
    {
        id: "cursor",
        label: "Cursor",
        detected: presence(".cursor"),
        config: jsonAt(join(".cursor", "mcp.json"), join(".cursor", "mcp.json")),
        merge: mergeMcpJson
    },
    {
        id: "gemini",
        label: "Gemini CLI",
        detected: presence(".gemini"),
        config: jsonAt(join(".gemini", "settings.json"), join(".gemini", "settings.json")),
        merge: mergeMcpJson
    },
    {
        id: "opencode",
        label: "opencode",
        detected: presence(join(".config", "opencode"), ".opencode"),
        // Its project config sits in the root rather than in a dotted directory, and is meant to be
        // committed — the only target whose project file is a normal part of the repository.
        config: jsonAt(join(".config", "opencode", "opencode.json"), "opencode.json"),
        merge: mergeOpencodeJson
    }
];

/** Every agent `--agent` accepts, so the command's choices cannot drift from the table. */
export const AGENT_IDS = TARGETS.map((target) => target.id);

/** Where each agent was looked for, for the message when nothing was detected. */
export function detectionSummary(): string {
    return TARGETS.map((target) => `${target.label} (~/${lookedFor(target.id)})`).join(", ");
}

function lookedFor(id: AgentId): string {
    switch (id) {
        case "claude-code":
            return ".claude";
        case "codex":
            return ".codex";
        case "cursor":
            return ".cursor";
        case "gemini":
            return ".gemini";
        default:
            return ".config/opencode";
    }
}

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

/**
 * Write motte's entry into one agent's config file.
 *
 * The same three steps for every target — read, merge, write if it changed — with the descriptor supplying
 * the path and the merge. The scope recorded is the file's own, not the one asked for: Codex has a single
 * global config, so `--scope project` still wires it at user scope, and `uninstall` has to know that.
 */
function configAction(target: Target, scope: Scope, path: string): Action {
    const actual: Scope = path.startsWith(home()) ? "user" : scope;

    return {
        agent: target.id,
        label: target.label,
        scope: actual,
        path,
        apply: () => {
            const merged = target.merge(read(path), path);
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

            if (existing !== undefined && hasBrokenMarkers(existing, AGENTS_MARKERS)) {
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

/**
 * The commit hook.
 *
 * Under `.git/hooks`, which is not a tracked file, so this is per-clone rather than per-project — the same
 * status as the agent configs and for the same reason: it describes this machine's setup.
 */
function hookAction(root: string): Action {
    const path = join(root, ".git", "hooks", HOOK_NAME);

    return {
        agent: "git-hook",
        label: "Commit hook",
        scope: "project",
        path,
        apply: () => {
            if (!existsSync(join(root, ".git"))) {
                throw new AgentConfigError(
                    `${root} is not a git repository, so there is nowhere to put a commit hook.`
                );
            }

            const existing = read(path);

            if (existing !== undefined && hasBrokenMarkers(existing, HOOK_MARKERS)) {
                throw new AgentConfigError(
                    `${path} has a motte start marker with no matching end marker, so it was left alone.`
                );
            }

            const merged = mergeHook(existing);
            if (!merged.unchanged) {
                put(path, merged.content);
                // Unexecutable hooks are ignored silently by git, which is the worst way for this to fail.
                chmodSync(path, 0o755);
            }

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
    /** Also install the prepare-commit-msg hook. Opt-in: a hook runs on everybody's commits. */
    withHooks?: boolean;
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
        const path = target.config(options.scope, () => requireRoot(options.root));

        // No file for this scope means the agent owns that config itself, which today is Claude Code's
        // `~/.claude.json` — full of its own state, so its CLI writes the entry rather than motte.
        actions.push(
            path === undefined
                ? claudeDelegatedAction(target.label, options.scope)
                : configAction(target, options.scope, path)
        );
    }

    // Instructions are worth leaving even when no agent is configured here — an agent may be wired up at
    // user scope, or on somebody else's clone of this repository.
    const root = resolveRoot(options.root);
    if (options.withoutInstructions !== true && root !== undefined) {
        actions.push(instructionsAction(root));
    }

    if (options.withHooks === true && root !== undefined) {
        actions.push(hookAction(root));
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
