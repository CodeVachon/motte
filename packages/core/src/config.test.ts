import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    CONFIG_FILENAME,
    ConfigError,
    ConfigNotFoundError,
    findConfigFile,
    loadConfig,
    loadConfigFrom,
    resolveState,
    stateCategory
} from "./config.js";

function write(config: unknown): string {
    const root = mkdtempSync(join(tmpdir(), "motte-config-"));
    const path = join(root, CONFIG_FILENAME);
    writeFileSync(path, JSON.stringify(config), "utf8");
    return path;
}

describe("discovery", () => {
    it("finds the config in the starting directory", () => {
        const path = write({ name: "here" });
        expect(findConfigFile(join(path, ".."))).toBe(path);
    });

    it("walks up from a nested subdirectory", () => {
        const path = write({ name: "up" });
        const nested = join(path, "..", "packages", "core", "src");
        mkdirSync(nested, { recursive: true });

        expect(findConfigFile(nested)).toBe(path);
    });

    it("returns undefined when there is no config anywhere above", () => {
        const empty = mkdtempSync(join(tmpdir(), "motte-empty-"));
        expect(findConfigFile(empty)).toBeUndefined();
    });

    it("throws a helpful error from loadConfig when nothing is found", () => {
        const empty = mkdtempSync(join(tmpdir(), "motte-empty-"));
        expect(() => loadConfig(empty)).toThrow(ConfigNotFoundError);
        expect(() => loadConfig(empty)).toThrow(/motte init/);
    });
});

describe("defaults", () => {
    it("applies the default states and issues directory", () => {
        const config = loadConfigFrom(write({}));

        expect(config.states.map((state) => state.name)).toEqual(["Todo", "In Progress", "Done"]);
        expect(config.issuesDir).toBe(".motte/issues");
        expect(config.issuesPath).toBe(join(config.root, ".motte/issues"));
    });

    it("names the project after its directory when unset", () => {
        const config = loadConfigFrom(write({}));
        expect(config.name.length).toBeGreaterThan(0);
    });

    it("falls back to the first configured state as the default", () => {
        const config = loadConfigFrom(
            write({
                states: [
                    { name: "Backlog", category: "unstarted" },
                    { name: "Done", category: "completed" }
                ]
            })
        );

        expect(config.defaultState).toBe("Backlog");
    });

    it("respects an absolute issuesDir", () => {
        const absolute = mkdtempSync(join(tmpdir(), "motte-abs-"));
        expect(loadConfigFrom(write({ issuesDir: absolute })).issuesPath).toBe(absolute);
    });
});

describe("validation", () => {
    it("rejects malformed JSON", () => {
        const root = mkdtempSync(join(tmpdir(), "motte-bad-"));
        const path = join(root, CONFIG_FILENAME);
        writeFileSync(path, "{ not json", "utf8");

        expect(() => loadConfigFrom(path)).toThrow(ConfigError);
    });

    it("rejects a defaultState that is not in states", () => {
        expect(() =>
            loadConfigFrom(
                write({
                    states: [{ name: "Todo", category: "unstarted" }],
                    defaultState: "Shipped"
                })
            )
        ).toThrow(/Shipped/);
    });

    it("rejects duplicate state names", () => {
        expect(() =>
            loadConfigFrom(
                write({
                    states: [
                        { name: "Todo", category: "unstarted" },
                        { name: "Todo", category: "completed" }
                    ]
                })
            )
        ).toThrow(/duplicate/);
    });

    it("rejects an unknown state category", () => {
        expect(() =>
            loadConfigFrom(write({ states: [{ name: "Todo", category: "wishful" }] }))
        ).toThrow(ConfigError);
    });

    it("rejects an empty state list", () => {
        expect(() => loadConfigFrom(write({ states: [] }))).toThrow(ConfigError);
    });
});

describe("resolveState", () => {
    const config = loadConfigFrom(
        write({
            states: [
                { name: "Todo", category: "unstarted" },
                { name: "In Progress", category: "started" },
                { name: "In Review", category: "started" },
                { name: "Done", category: "completed" }
            ]
        })
    );

    it("matches exactly, ignoring case", () => {
        expect(resolveState(config, "done").name).toBe("Done");
        expect(resolveState(config, "IN PROGRESS").name).toBe("In Progress");
    });

    it("matches a unique prefix", () => {
        expect(resolveState(config, "in prog").name).toBe("In Progress");
        expect(resolveState(config, "t").name).toBe("Todo");
    });

    it("rejects an ambiguous prefix, naming the candidates", () => {
        expect(() => resolveState(config, "in ")).toThrow(/In Progress, In Review/);
    });

    it("rejects an unknown state, listing what is configured", () => {
        expect(() => resolveState(config, "shipped")).toThrow(/Configured states/);
    });

    it("prefers an exact match over a prefix match", () => {
        const overlapping = loadConfigFrom(
            write({
                states: [
                    { name: "Done", category: "completed" },
                    { name: "Done Later", category: "unstarted" }
                ]
            })
        );

        expect(resolveState(overlapping, "Done").name).toBe("Done");
    });
});

describe("stateCategory", () => {
    const config = loadConfigFrom(write({}));

    it("returns the category for a known state", () => {
        expect(stateCategory(config, "Done")).toBe("completed");
    });

    it("returns undefined for an unknown state", () => {
        expect(stateCategory(config, "Nope")).toBeUndefined();
    });
});
