import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    rmdirSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { timestamp } from "@motte/core";
import {
    removeFromCodexToml,
    removeFromMcpJson,
    removeFromOpencodeJson,
    type RemoveResult
} from "./agents.js";
import { removeFromHook } from "./hooks.js";
import { removeFromAgentsMd } from "./instructions.js";

/**
 * What was wired. `agents-md` is not an agent but the AGENTS.md block, which every supported agent
 * reads — recording it the same way is what lets `uninstall` remove exactly that block.
 */
export type AgentId =
    "claude-code" | "codex" | "cursor" | "gemini" | "opencode" | "agents-md" | "git-hook";
export type Scope = "project" | "user" | "local";

export interface WiringEntry {
    agent: AgentId;
    scope: Scope;
    /** The file that was touched. Absent when another tool owns it (see `delegated`). */
    path?: string;
    /**
     * True when motte created the file, as opposed to merging into one that already existed.
     *
     * This is the whole reason the record exists: uninstall deletes a file motte created, but only
     * removes its own key from a file it merged into. Guessing wrong destroys someone's config.
     */
    createdFile?: boolean;
    /** True when the write was delegated to the agent's own CLI, so motte cannot reverse it itself. */
    delegated?: boolean;
    at: string;
}

interface RecordFile {
    entries: WiringEntry[];
}

/**
 * Where the record lives.
 *
 * Under the install root rather than in the project, because the wiring it describes can be
 * user-scoped and therefore has nothing to do with any one project.
 */
function recordPath(): string {
    const root =
        process.env.MOTTE_INSTALL_DIR ??
        join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".motte");
    return join(root, "installed-agents.json");
}

export function readRecord(path: string = recordPath()): WiringEntry[] {
    if (!existsSync(path)) return [];

    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as RecordFile;
        return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
        // A corrupt record must not block uninstalling. Worst case the caller falls back to asking.
        return [];
    }
}

export function writeRecord(entries: WiringEntry[], path: string = recordPath()): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

/** Add an entry, replacing any previous one for the same agent and scope so re-running is idempotent. */
export function rememberWiring(entry: Omit<WiringEntry, "at">, path: string = recordPath()): void {
    const entries = readRecord(path).filter(
        (existing) => !(existing.agent === entry.agent && existing.scope === entry.scope)
    );

    entries.push({ ...entry, at: timestamp() });
    writeRecord(entries, path);
}

export interface UnwireOutcome {
    entry: WiringEntry;
    result: "removed-key" | "deleted-file" | "not-found" | "delegated" | "failed";
    detail?: string;
}

/**
 * How to take motte back out of a given file.
 *
 * Keyed on which agent wrote it, not on the filename. It used to key on the extension, and `opencode.json`
 * is what broke that: it ends in `.json` like Cursor's and Claude Code's files but keeps its servers under
 * `mcp` rather than `mcpServers`, so the extension test would have quietly removed nothing and reported
 * success. The agent is recorded at install time and is the fact that actually determines the shape.
 */
function removerFor(entry: WiringEntry): (existing: string, path: string) => RemoveResult {
    switch (entry.agent) {
        case "git-hook":
            return (existing) => removeFromHook(existing);
        case "agents-md":
            return (existing) => removeFromAgentsMd(existing);
        case "codex":
            return (existing) => removeFromCodexToml(existing);
        case "opencode":
            return removeFromOpencodeJson;
        // Claude Code, Cursor and Gemini CLI all keep `mcpServers` in a JSON file.
        default:
            return removeFromMcpJson;
    }
}

/**
 * Remove the directory a deleted config lived in, if nothing else is in it.
 *
 * Cursor and Gemini CLI keep their config in `.cursor/` and `.gemini/`, which motte creates if they are
 * not there — so uninstalling used to leave two empty directories behind. `rmdir` refuses a directory
 * that is not empty, which is what makes this safe: somebody's `.cursor/rules` keeps the directory, and
 * a failure here is simply nothing to tidy.
 */
function tidyParent(path: string): void {
    try {
        rmdirSync(dirname(path));
    } catch {
        // Not empty, or not ours to remove. Either way there is nothing to do.
    }
}

/**
 * Reverse one recorded wiring.
 *
 * Deletes the file only when motte created it. Anything motte merely merged into keeps everything
 * except motte's own entry.
 */
export function unwire(entry: WiringEntry): UnwireOutcome {
    if (entry.delegated === true) {
        return {
            entry,
            result: "delegated",
            detail:
                entry.agent === "claude-code"
                    ? "run `claude mcp remove motte` — that config belongs to Claude Code"
                    : "remove it with the agent's own CLI"
        };
    }

    if (entry.path === undefined || !existsSync(entry.path)) {
        return { entry, result: "not-found" };
    }

    try {
        const existing = readFileSync(entry.path, "utf8");

        const outcome = removerFor(entry)(existing, entry.path);

        if (outcome.absent) return { entry, result: "not-found" };

        // Delete only what motte brought into being. A file that predated motte keeps existing, minus
        // motte's entry — even if that leaves it empty.
        if (outcome.empty && entry.createdFile === true) {
            unlinkSync(entry.path);
            tidyParent(entry.path);
            return { entry, result: "deleted-file" };
        }

        writeFileSync(entry.path, outcome.content, "utf8");
        return { entry, result: "removed-key" };
    } catch (error) {
        return {
            entry,
            result: "failed",
            detail: error instanceof Error ? error.message : String(error)
        };
    }
}

export function forgetRecord(path: string = recordPath()): void {
    rmSync(path, { force: true });
}
