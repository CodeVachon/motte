import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initialised, motte } from "../testing/cli.js";
import { AGENT_IDS } from "./wiring.js";

/**
 * The agent targets, against real files on disk.
 *
 * `agents.test.ts` covers the merges in isolation. What is checked here is the part that cannot be checked
 * purely: that each agent's entry lands at the path that agent actually reads, that a config somebody
 * already had survives, and that `uninstall` takes motte back out of it.
 *
 * Every case starts from a realistic file with another server already in it. An empty file would pass
 * whatever the merge did.
 */

/** The sandbox home the test harness points HOME at. */
function sandboxHome(root: string): string {
    return join(root, ".test-home");
}

interface Target {
    id: string;
    /** Where the entry lands for `--scope user`, relative to the sandbox home. */
    userPath: string;
    /** Where it lands for `--scope project`, relative to the project root. */
    projectPath: string;
    /** A config the user already had, with another server in it. */
    existing: string;
    /** Pull motte's entry out of the written file, or undefined if it is not there. */
    entry: (content: string) => unknown;
    /** Something of the user's that must survive. */
    survives: (content: string) => boolean;
}

const MCP_SERVERS = JSON.stringify(
    { mcpServers: { weather: { command: "weather-mcp", args: ["--stdio"] } } },
    null,
    2
);

const TARGETS: Target[] = [
    {
        id: "cursor",
        userPath: join(".cursor", "mcp.json"),
        projectPath: join(".cursor", "mcp.json"),
        existing: MCP_SERVERS,
        entry: (content) => JSON.parse(content).mcpServers?.motte,
        survives: (content) => JSON.parse(content).mcpServers?.weather !== undefined
    },
    {
        id: "gemini",
        userPath: join(".gemini", "settings.json"),
        projectPath: join(".gemini", "settings.json"),
        // Gemini keeps the rest of its settings in this same file, which is the thing most at risk.
        existing: JSON.stringify(
            { theme: "GitHub", mcpServers: { weather: { command: "weather-mcp" } } },
            null,
            2
        ),
        entry: (content) => JSON.parse(content).mcpServers?.motte,
        survives: (content) => JSON.parse(content).theme === "GitHub"
    },
    {
        id: "opencode",
        userPath: join(".config", "opencode", "opencode.json"),
        projectPath: "opencode.json",
        existing: JSON.stringify(
            { theme: "tokyonight", mcp: { weather: { type: "local", command: ["weather-mcp"] } } },
            null,
            2
        ),
        entry: (content) => JSON.parse(content).mcp?.motte,
        survives: (content) => JSON.parse(content).theme === "tokyonight"
    }
];

function put(path: string, content: string): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
}

describe("agent targets", () => {
    it("are all offered by --agent", () => {
        expect(AGENT_IDS).toEqual(["claude-code", "codex", "cursor", "gemini", "opencode"]);
    });

    /**
     * The closing advice used to name `.mcp.json` and `AGENTS.md` whatever had happened, which went wrong
     * the moment there were targets with other config files: installing for Cursor and opencode told the
     * user to commit a file that did not exist, and not the two that did.
     */
    it("advise committing the files that were actually written", async () => {
        const root = await initialised();

        const run = await motte(root, ["install", "--agent", "opencode"]);

        expect(run.stdout).toContain("Commit opencode.json, AGENTS.md");
        expect(run.stdout).not.toContain(".mcp.json");
    });

    it("advise committing nothing when the config is user-scoped", async () => {
        const root = await initialised();

        const run = await motte(root, [
            "install",
            "--agent",
            "cursor",
            "--scope",
            "user",
            "--no-instructions"
        ]);

        expect(run.code).toBe(0);
        expect(run.stdout).not.toContain("Commit");
    });

    for (const target of TARGETS) {
        describe(target.id, () => {
            it("writes into the config it already had, at user scope", async () => {
                const root = await initialised();
                const path = join(sandboxHome(root), target.userPath);
                put(path, target.existing);

                const run = await motte(root, [
                    "install",
                    "--agent",
                    target.id,
                    "--scope",
                    "user",
                    "--no-instructions"
                ]);

                expect(run.code).toBe(0);

                const written = readFileSync(path, "utf8");
                expect(target.entry(written)).toBeDefined();
                expect(target.survives(written)).toBe(true);
            });

            it("writes into the project when asked for project scope", async () => {
                const root = await initialised();

                const run = await motte(root, [
                    "install",
                    "--agent",
                    target.id,
                    "--scope",
                    "project",
                    "--no-instructions"
                ]);

                expect(run.code).toBe(0);
                expect(existsSync(join(root, target.projectPath))).toBe(true);
                expect(
                    target.entry(readFileSync(join(root, target.projectPath), "utf8"))
                ).toBeDefined();
            });

            it("changes nothing the second time", async () => {
                const root = await initialised();
                const args = ["install", "--agent", target.id, "--no-instructions"];

                await motte(root, args);
                const path = join(root, target.projectPath);
                const once = readFileSync(path, "utf8");

                await motte(root, args);

                expect(readFileSync(path, "utf8")).toBe(once);
            });

            it("is taken back out by uninstall, leaving what was already there", async () => {
                const root = await initialised();
                const path = join(root, target.projectPath);
                put(path, target.existing);

                await motte(root, ["install", "--agent", target.id, "--no-instructions"]);
                expect(target.entry(readFileSync(path, "utf8"))).toBeDefined();

                await motte(root, ["uninstall", "--keep-cli", "--yes"]);

                const left = readFileSync(path, "utf8");
                expect(target.entry(left)).toBeUndefined();
                expect(target.survives(left)).toBe(true);
            });

            /** Deleted only because motte created it. A config that predated motte is never removed. */
            it("deletes a config file it created itself", async () => {
                const root = await initialised();
                const path = join(root, target.projectPath);

                await motte(root, ["install", "--agent", target.id, "--no-instructions"]);
                expect(existsSync(path)).toBe(true);

                await motte(root, ["uninstall", "--keep-cli", "--yes"]);

                expect(existsSync(path)).toBe(false);
            });

            /**
             * Cursor and Gemini keep config in a directory motte creates, and uninstall left both behind
             * empty. Anything else in there keeps the directory — `rmdir` refuses a non-empty one.
             */
            it("leaves no empty directory behind, unless something else is in it", async () => {
                const dir = join(target.projectPath, "..");

                const bare = await initialised();
                await motte(bare, ["install", "--agent", target.id, "--no-instructions"]);
                await motte(bare, ["uninstall", "--keep-cli", "--yes"]);
                expect(existsSync(join(bare, dir))).toBe(dir === ".");

                const shared = await initialised();
                await motte(shared, ["install", "--agent", target.id, "--no-instructions"]);
                put(join(shared, dir, "theirs.txt"), "not motte's");
                await motte(shared, ["uninstall", "--keep-cli", "--yes"]);
                expect(existsSync(join(shared, dir, "theirs.txt"))).toBe(true);
            });

            it("refuses a config it cannot parse rather than clobbering it", async () => {
                const root = await initialised();
                const path = join(root, target.projectPath);
                put(path, "{ this is not json");

                const run = await motte(root, [
                    "install",
                    "--agent",
                    target.id,
                    "--no-instructions"
                ]);

                expect(run.code).not.toBe(0);
                expect(readFileSync(path, "utf8")).toBe("{ this is not json");
            });
        });
    }
});
