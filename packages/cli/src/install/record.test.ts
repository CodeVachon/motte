import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeCodexToml, mergeMcpJson } from "./agents.js";
import { readRecord, rememberWiring, unwire, writeRecord, type WiringEntry } from "./record.js";

function scratch(): string {
    return mkdtempSync(join(tmpdir(), "motte-record-"));
}

describe("the record itself", () => {
    it("returns nothing when there is no record", () => {
        expect(readRecord(join(scratch(), "installed-agents.json"))).toEqual([]);
    });

    it("survives a corrupt record rather than blocking an uninstall", () => {
        const path = join(scratch(), "installed-agents.json");
        writeFileSync(path, "{ not json", "utf8");

        expect(readRecord(path)).toEqual([]);
    });

    it("round-trips entries", () => {
        const path = join(scratch(), "installed-agents.json");
        const entry: WiringEntry = {
            agent: "codex",
            scope: "user",
            path: "/tmp/config.toml",
            at: "2026-07-30T12:00:00Z"
        };

        writeRecord([entry], path);
        expect(readRecord(path)).toEqual([entry]);
    });

    it("replaces the previous entry for the same agent and scope, so re-running does not duplicate", () => {
        const path = join(scratch(), "installed-agents.json");

        rememberWiring({ agent: "claude-code", scope: "project", path: "/a/.mcp.json" }, path);
        rememberWiring({ agent: "claude-code", scope: "project", path: "/b/.mcp.json" }, path);
        rememberWiring({ agent: "claude-code", scope: "user", delegated: true }, path);

        const entries = readRecord(path);
        expect(entries).toHaveLength(2);
        expect(entries.find((e) => e.scope === "project")?.path).toBe("/b/.mcp.json");
    });
});

/**
 * The distinction the record exists for: a file motte created is deleted, a file motte merged into
 * keeps everything except motte's own entry. Guessing wrong destroys someone's configuration.
 */
describe("unwire", () => {
    it("deletes a .mcp.json that motte created", () => {
        const dir = scratch();
        const path = join(dir, ".mcp.json");
        writeFileSync(path, mergeMcpJson(undefined).content, "utf8");

        const outcome = unwire({
            agent: "claude-code",
            scope: "project",
            path,
            createdFile: true,
            at: "now"
        });

        expect(outcome.result).toBe("deleted-file");
        expect(existsSync(path)).toBe(false);
    });

    it("keeps a .mcp.json that already existed, removing only motte", () => {
        const dir = scratch();
        const path = join(dir, ".mcp.json");
        writeFileSync(
            path,
            mergeMcpJson(JSON.stringify({ mcpServers: { sentry: { command: "sentry-mcp" } } }))
                .content,
            "utf8"
        );

        const outcome = unwire({ agent: "claude-code", scope: "project", path, at: "now" });

        expect(outcome.result).toBe("removed-key");
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, "utf8")).toContain("sentry");
        expect(readFileSync(path, "utf8")).not.toContain("motte");
    });

    it("leaves an empty file behind rather than deleting one motte did not create", () => {
        const dir = scratch();
        const path = join(dir, ".mcp.json");
        // motte merged into a file that happened to have no other servers.
        writeFileSync(path, mergeMcpJson(JSON.stringify({ mcpServers: {} })).content, "utf8");

        const outcome = unwire({ agent: "claude-code", scope: "project", path, at: "now" });

        // createdFile is absent, so the file is not ours to delete even though it is now empty.
        expect(outcome.result).toBe("removed-key");
        expect(existsSync(path)).toBe(true);
    });

    it("removes our table from a codex config, keeping the rest", () => {
        const dir = scratch();
        const path = join(dir, "config.toml");
        writeFileSync(
            path,
            mergeCodexToml('model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n').content,
            "utf8"
        );

        const outcome = unwire({ agent: "codex", scope: "user", path, at: "now" });
        const remaining = readFileSync(path, "utf8");

        expect(outcome.result).toBe("removed-key");
        expect(remaining).toContain('model = "gpt-5"');
        expect(remaining).toContain("[mcp_servers.other]");
        expect(remaining).not.toContain("[mcp_servers.motte]");
    });

    it("reports not-found for a file that has gone", () => {
        const outcome = unwire({
            agent: "claude-code",
            scope: "project",
            path: join(scratch(), "absent.mcp.json"),
            at: "now"
        });

        expect(outcome.result).toBe("not-found");
    });

    it("reports not-found when motte was already removed by hand", () => {
        const dir = scratch();
        const path = join(dir, ".mcp.json");
        writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }), "utf8");

        expect(unwire({ agent: "claude-code", scope: "project", path, at: "now" }).result).toBe(
            "not-found"
        );
    });

    it("tells the user to use the agent's own CLI for a delegated write", () => {
        const outcome = unwire({
            agent: "claude-code",
            scope: "user",
            delegated: true,
            at: "now"
        });

        // motte never learned that file's schema, so it must not guess at unpicking it either.
        expect(outcome.result).toBe("delegated");
        expect(outcome.detail).toContain("claude mcp remove");
    });

    it("reports a failure rather than throwing, so one bad entry does not abort the rest", () => {
        const dir = scratch();
        const path = join(dir, ".mcp.json");
        writeFileSync(path, "{ not json", "utf8");

        const outcome = unwire({ agent: "claude-code", scope: "project", path, at: "now" });

        expect(outcome.result).toBe("failed");
        expect(outcome.detail).toBeDefined();
        // And the unreadable file is left exactly as it was.
        expect(readFileSync(path, "utf8")).toBe("{ not json");
    });
});
