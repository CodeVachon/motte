import { describe, expect, it } from "vitest";
import {
    AgentConfigError,
    mergeCodexToml,
    mergeMcpJson,
    mergeOpencodeJson,
    removeFromCodexToml,
    removeFromMcpJson,
    removeFromOpencodeJson
} from "./agents.js";

describe("mergeMcpJson", () => {
    it("creates the file when there is none", () => {
        const result = mergeMcpJson(undefined);

        expect(result.created).toBe(true);
        expect(JSON.parse(result.content)).toEqual({
            mcpServers: { motte: { command: "motte", args: ["mcp"] } }
        });
    });

    it("keeps other servers", () => {
        const existing = JSON.stringify({
            mcpServers: { sentry: { command: "sentry-mcp", args: ["--stdio"] } }
        });

        const merged = JSON.parse(mergeMcpJson(existing).content) as {
            mcpServers: Record<string, unknown>;
        };

        expect(Object.keys(merged.mcpServers).sort()).toEqual(["motte", "sentry"]);
        expect(merged.mcpServers.sentry).toEqual({ command: "sentry-mcp", args: ["--stdio"] });
    });

    /**
     * A file somebody created and left blank. `JSON.parse("")` throws, so this used to be reported as an
     * unparseable config and refused — careful in the wrong direction, since there is nothing to lose.
     */
    it("fills in a file that exists but is empty", () => {
        const merged = mergeMcpJson("   \n");

        expect(merged.unchanged).toBe(false);
        expect(JSON.parse(merged.content).mcpServers.motte).toBeDefined();
    });

    it("keeps unrelated top-level keys", () => {
        const existing = JSON.stringify({ someOtherSetting: 42, mcpServers: {} });
        const merged = JSON.parse(mergeMcpJson(existing).content) as { someOtherSetting: number };

        expect(merged.someOtherSetting).toBe(42);
    });

    it("reports an identical existing entry as unchanged, so re-running is idempotent", () => {
        const first = mergeMcpJson(undefined).content;
        const second = mergeMcpJson(first);

        expect(second.unchanged).toBe(true);
        expect(second.created).toBe(false);
    });

    it("replaces an entry that differs", () => {
        const existing = JSON.stringify({
            mcpServers: { motte: { command: "/old/path/motte", args: ["mcp", "--stale"] } }
        });
        const result = mergeMcpJson(existing);

        expect(result.unchanged).toBe(false);
        expect(
            (JSON.parse(result.content) as { mcpServers: { motte: { command: string } } })
                .mcpServers.motte.command
        ).toBe("motte");
    });

    it("refuses an unparseable file rather than overwriting it", () => {
        // Clobbering a config we cannot read would destroy whatever else the user had there.
        expect(() => mergeMcpJson("{ not json")).toThrow(AgentConfigError);
        expect(() => mergeMcpJson("{ not json")).toThrow(/left alone/);
    });

    it("refuses a file whose top level is not an object", () => {
        expect(() => mergeMcpJson("[1, 2, 3]")).toThrow(AgentConfigError);
    });
});

describe("removeFromMcpJson", () => {
    it("removes only motte, leaving other servers", () => {
        const existing = mergeMcpJson(
            JSON.stringify({ mcpServers: { sentry: { command: "sentry-mcp" } } })
        ).content;

        const result = removeFromMcpJson(existing);
        const parsed = JSON.parse(result.content) as { mcpServers: Record<string, unknown> };

        expect(Object.keys(parsed.mcpServers)).toEqual(["sentry"]);
        expect(result.empty).toBe(false);
    });

    it("reports empty when motte was the only thing in the file", () => {
        const result = removeFromMcpJson(mergeMcpJson(undefined).content);
        expect(result.empty).toBe(true);
    });

    it("does not report empty when other top-level keys remain", () => {
        const existing = mergeMcpJson(
            JSON.stringify({ someOtherSetting: 1, mcpServers: {} })
        ).content;

        // The file predates motte in spirit, so it should survive even with no servers left.
        expect(removeFromMcpJson(existing).empty).toBe(false);
    });

    it("reports absent when motte was never configured", () => {
        const result = removeFromMcpJson(JSON.stringify({ mcpServers: { other: {} } }));

        expect(result.absent).toBe(true);
        expect(result.empty).toBe(false);
    });
});

describe("mergeCodexToml", () => {
    const existing = [
        "# My settings — this comment must survive.",
        'model = "gpt-5"',
        "",
        "[mcp_servers.other]",
        'command = "other-mcp"',
        ""
    ].join("\n");

    it("creates the block when there is no file", () => {
        const result = mergeCodexToml(undefined);

        expect(result.created).toBe(true);
        expect(result.content).toContain("[mcp_servers.motte]");
        expect(result.content).toContain('args = ["mcp"]');
    });

    /**
     * The reason this is a targeted edit rather than a TOML round-trip: parsing and re-emitting would
     * lose comments and formatting the user cares about.
     */
    it("appends without disturbing comments or other tables", () => {
        const result = mergeCodexToml(existing);

        expect(result.content).toContain("# My settings — this comment must survive.");
        expect(result.content).toContain('model = "gpt-5"');
        expect(result.content).toContain("[mcp_servers.other]");
        expect(result.content).toContain("[mcp_servers.motte]");
    });

    it("reports unchanged when the block is already exactly right", () => {
        const once = mergeCodexToml(existing).content;
        expect(mergeCodexToml(once).unchanged).toBe(true);
    });

    it("replaces a stale block in place rather than duplicating it", () => {
        const stale = [
            'model = "gpt-5"',
            "",
            "[mcp_servers.motte]",
            'command = "/old/path/motte"',
            "",
            "[mcp_servers.other]",
            'command = "other-mcp"'
        ].join("\n");

        const result = mergeCodexToml(stale);
        const occurrences = result.content.split("[mcp_servers.motte]").length - 1;

        expect(occurrences).toBe(1);
        expect(result.content).not.toContain("/old/path/motte");
        // The table that followed ours is still there.
        expect(result.content).toContain("[mcp_servers.other]");
    });

    it("treats a whitespace-only file as empty", () => {
        expect(mergeCodexToml("\n\n  \n").content.trim().startsWith("[mcp_servers.motte]")).toBe(
            true
        );
    });
});

describe("removeFromCodexToml", () => {
    it("removes our table and leaves everything else", () => {
        const withMotte = mergeCodexToml(
            ['model = "gpt-5"', "", "[mcp_servers.other]", 'command = "other-mcp"'].join("\n")
        ).content;

        const result = removeFromCodexToml(withMotte);

        expect(result.content).toContain('model = "gpt-5"');
        expect(result.content).toContain("[mcp_servers.other]");
        expect(result.content).not.toContain("[mcp_servers.motte]");
        expect(result.empty).toBe(false);
    });

    it("removes a table that is followed by another one", () => {
        const source = [
            "[mcp_servers.motte]",
            'command = "motte"',
            'args = ["mcp"]',
            "",
            "[mcp_servers.other]",
            'command = "other-mcp"'
        ].join("\n");

        const result = removeFromCodexToml(source);

        expect(result.content).not.toContain("motte");
        expect(result.content).toContain("[mcp_servers.other]");
    });

    it("reports empty when ours was the only table", () => {
        expect(removeFromCodexToml(mergeCodexToml(undefined).content).empty).toBe(true);
    });

    it("reports absent when ours was never there", () => {
        const result = removeFromCodexToml('model = "gpt-5"\n');

        expect(result.absent).toBe(true);
        expect(result.content).toBe('model = "gpt-5"\n');
    });

    it("round-trips: merge then remove restores the original meaning", () => {
        const original = ['model = "gpt-5"', "", "[mcp_servers.other]", 'command = "x"'].join("\n");
        const restored = removeFromCodexToml(mergeCodexToml(original).content).content;

        expect(restored.trim()).toBe(original.trim());
    });
});

/**
 * opencode, which is the target that does not fit the others.
 *
 * Its servers live under `mcp` rather than `mcpServers`, and an entry takes the whole command line as one
 * array with an explicit `type` and `enabled`. Reusing the `mcpServers` writer would have produced a file
 * opencode parses happily and then ignores — a success message and no working server.
 */
describe("mergeOpencodeJson", () => {
    it("writes the shape opencode actually reads", () => {
        const result = mergeOpencodeJson(undefined);

        expect(result.created).toBe(true);
        expect(JSON.parse(result.content)).toEqual({
            $schema: "https://opencode.ai/config.json",
            mcp: { motte: { type: "local", command: ["motte", "mcp"], enabled: true } }
        });
    });

    it("keeps other servers and the rest of the config", () => {
        const existing = JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            theme: "tokyonight",
            model: "anthropic/claude-opus-5",
            mcp: { weather: { type: "local", command: ["weather-mcp"], enabled: true } }
        });

        const merged = JSON.parse(mergeOpencodeJson(existing).content) as {
            theme: string;
            model: string;
            mcp: Record<string, unknown>;
        };

        expect(merged.theme).toBe("tokyonight");
        expect(merged.model).toBe("anthropic/claude-opus-5");
        expect(Object.keys(merged.mcp).sort()).toEqual(["motte", "weather"]);
    });

    /** Never added to a file somebody else wrote: motte only writes `$schema` in a file it creates. */
    it("does not add a schema to a config that had none", () => {
        const merged = JSON.parse(
            mergeOpencodeJson(JSON.stringify({ theme: "gruvbox" })).content
        ) as Record<string, unknown>;

        expect(merged.$schema).toBeUndefined();
        expect(merged.theme).toBe("gruvbox");
    });

    it("reports an identical entry as unchanged, so re-running writes nothing", () => {
        const once = mergeOpencodeJson(undefined);

        expect(mergeOpencodeJson(once.content)).toMatchObject({ unchanged: true });
    });

    it("treats an empty file as one to fill in rather than one to parse", () => {
        expect(mergeOpencodeJson("   \n").unchanged).toBe(false);
        expect(JSON.parse(mergeOpencodeJson("   \n").content).mcp.motte).toBeDefined();
    });

    it("refuses a config it cannot parse rather than overwriting it", () => {
        expect(() => mergeOpencodeJson("{ not json", "opencode.json")).toThrow(AgentConfigError);
    });
});

describe("removeFromOpencodeJson", () => {
    it("takes motte out and leaves everything else", () => {
        const existing = mergeOpencodeJson(
            JSON.stringify({
                theme: "gruvbox",
                mcp: { weather: { type: "local", command: ["weather-mcp"], enabled: true } }
            })
        ).content;

        const removed = removeFromOpencodeJson(existing);
        const config = JSON.parse(removed.content) as {
            theme: string;
            mcp: Record<string, unknown>;
        };

        expect(removed.absent).toBe(false);
        expect(removed.empty).toBe(false);
        expect(config.theme).toBe("gruvbox");
        expect(Object.keys(config.mcp)).toEqual(["weather"]);
    });

    /** So `uninstall` can delete a file that exists only because motte created it. */
    it("reports a config that held nothing but motte as empty", () => {
        expect(removeFromOpencodeJson(mergeOpencodeJson(undefined).content).empty).toBe(true);
    });

    it("says so when motte was not configured there", () => {
        const existing = JSON.stringify({ mcp: { weather: { type: "local" } } });

        expect(removeFromOpencodeJson(existing)).toMatchObject({ absent: true, content: existing });
    });

    /**
     * The bug this file's shape invites: `mcpServers` and `mcp` are one character apart, and a config
     * written under the wrong key would be reported as installed and never loaded.
     */
    it("does not confuse itself with an mcpServers file", () => {
        const cursorish = JSON.stringify({ mcpServers: { motte: { command: "motte" } } });

        expect(removeFromOpencodeJson(cursorish).absent).toBe(true);
    });
});
