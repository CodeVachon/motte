import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFrom } from "./config.js";
import { DEFAULT_STATES } from "./schema/config.js";
import { watchBacklog, type BacklogChange, type WatchFactory } from "./watch.js";
import type { Config } from "./schema/config.js";

/**
 * The watcher's logic, driven by delivering directory events directly.
 *
 * An earlier version of this file wrote real files and waited for macOS to notice. Every assertion held
 * when the file ran alone and failed roughly one full-suite run in three: with two dozen files running in
 * parallel, delivery ranged from immediate to not-within-five-seconds, and a burst of five writes was
 * sometimes reported as five changes because the events genuinely arrived further apart than the debounce.
 * None of that is this module's behaviour — it is Node's and the kernel's.
 *
 * So the factory is injected and the events are synthesised. What is tested here is the mapping from a
 * sequence of directory events to a sequence of changes: attribution, coalescing, and shutdown. One
 * integration test at the bottom covers the wiring to the real `fs.watch`, and is the only test in this
 * file that can be affected by how busy the machine is.
 */

const stops: (() => void)[] = [];

afterEach(() => {
    while (stops.length > 0) stops.pop()!();
});

function project(withEvents = true): Config {
    const root = mkdtempSync(join(tmpdir(), "motte-watch-"));
    const configPath = join(root, ".motte.config.json");

    writeFileSync(
        configPath,
        JSON.stringify({
            name: "watch",
            issuesDir: ".motte/issues",
            states: DEFAULT_STATES,
            events: { enabled: withEvents }
        }),
        "utf8"
    );

    const config = loadConfigFrom(configPath);
    mkdirSync(config.issuesPath, { recursive: true });
    if (withEvents) mkdirSync(join(config.root, ".motte", "events"), { recursive: true });

    return config;
}

interface Fake {
    factory: WatchFactory;
    fire: (dir: "issues" | "events", filename: string | null) => void;
    watching: string[];
    closedCount: () => number;
}

/** A factory handing back a way to deliver events per directory, keyed by which one it is. */
function fakeWatcher(): Fake {
    const listeners = new Map<string, (filename: string | null) => void>();
    const watching: string[] = [];
    let closed = 0;

    return {
        watching,
        closedCount: () => closed,
        factory: (dir, onEvent) => {
            const key = dir.endsWith("events") ? "events" : "issues";
            listeners.set(key, onEvent);
            watching.push(key);
            return {
                close() {
                    closed += 1;
                }
            };
        },
        fire: (dir, filename) => listeners.get(dir)?.(filename)
    };
}

const DEBOUNCE = 5;

/** Start a watcher whose events are delivered by hand, and collect what it reports. */
function harness(config: Config) {
    const fake = fakeWatcher();
    const changes: BacklogChange[] = [];

    const stop = watchBacklog(config, (change) => changes.push(change), {
        debounceMs: DEBOUNCE,
        watchDir: fake.factory
    });
    stops.push(stop);

    return {
        ...fake,
        changes,
        stop,
        settle: (): Promise<void> => new Promise((resolve) => setTimeout(resolve, DEBOUNCE * 6))
    };
}

describe("watchBacklog", () => {
    it("watches the issues directory, and the event log when enabled", () => {
        expect(harness(project(true)).watching.sort()).toEqual(["events", "issues"]);
    });

    it("does not watch the event log when it is disabled", () => {
        expect(harness(project(false)).watching).toEqual(["issues"]);
    });

    it("attributes an issue write to the id in its filename", async () => {
        const h = harness(project());

        h.fire("issues", "0007-a-thing.md");
        await h.settle();

        expect(h.changes).toEqual([{ ids: [7], events: false }]);
    });

    it("reads the id as a number, without its zero padding", async () => {
        const h = harness(project());

        h.fire("issues", "0042-x.md");
        await h.settle();

        expect(h.changes[0]!.ids).toEqual([42]);
    });

    /**
     * The reason the debounce exists. `IssueStore` writes to a temp file and renames it, so one logical
     * write is several directory events; a `breakdown` creating ten children is ten writes in a row.
     */
    it("collapses a burst into one change, de-duplicated and sorted", async () => {
        const h = harness(project());

        for (const id of [3, 1, 2, 1]) h.fire("issues", `${String(id).padStart(4, "0")}-x.md`);
        await h.settle();

        expect(h.changes).toHaveLength(1);
        expect(h.changes[0]!.ids).toEqual([1, 2, 3]);
    });

    it("reports separate bursts separately", async () => {
        const h = harness(project());

        h.fire("issues", "0001-x.md");
        await h.settle();
        h.fire("issues", "0002-x.md");
        await h.settle();

        expect(h.changes).toEqual([
            { ids: [1], events: false },
            { ids: [2], events: false }
        ]);
    });

    it("flags an event-log write instead of attributing it to an issue", async () => {
        const h = harness(project());

        h.fire("events", "2026-07.claude.ndjson");
        await h.settle();

        expect(h.changes).toEqual([{ ids: [], events: true }]);
    });

    it("reports both when an issue and the log change together", async () => {
        const h = harness(project());

        h.fire("issues", "0005-x.md");
        h.fire("events", "2026-07.claude.ndjson");
        await h.settle();

        expect(h.changes).toEqual([{ ids: [5], events: true }]);
    });

    /**
     * The atomic write's temp file has no id prefix, and macOS also reports events naming the watched
     * directory itself. Both are real changes with nothing to attribute them to.
     */
    it("reports a filename with no id prefix as a change with no ids", async () => {
        const h = harness(project());

        h.fire("issues", "issues");
        await h.settle();

        expect(h.changes).toEqual([{ ids: [], events: false }]);
    });

    it("survives a null filename", async () => {
        const h = harness(project());

        h.fire("issues", null);
        await h.settle();

        expect(h.changes).toEqual([{ ids: [], events: false }]);
    });

    it("does not carry ids over into the next change", async () => {
        const h = harness(project());

        h.fire("issues", "0001-x.md");
        await h.settle();
        h.fire("issues", "issues");
        await h.settle();

        expect(h.changes[1]).toEqual({ ids: [], events: false });
    });

    it("reports nothing once stopped, and closes every watcher", async () => {
        const h = harness(project());

        h.stop();
        h.fire("issues", "0001-x.md");
        await h.settle();

        expect(h.changes).toEqual([]);
        expect(h.closedCount()).toBe(2);
    });

    it("drops a change that was still pending when it stopped", async () => {
        const h = harness(project());

        h.fire("issues", "0001-x.md");
        h.stop();
        await h.settle();

        expect(h.changes).toEqual([]);
    });

    it("stops on an aborted signal", async () => {
        const controller = new AbortController();
        const changes: BacklogChange[] = [];
        const fake = fakeWatcher();

        stops.push(
            watchBacklog(project(), (change) => changes.push(change), {
                debounceMs: DEBOUNCE,
                watchDir: fake.factory,
                signal: controller.signal
            })
        );

        controller.abort();
        fake.fire("issues", "0001-x.md");
        await new Promise((resolve) => setTimeout(resolve, DEBOUNCE * 6));

        expect(changes).toEqual([]);
    });

    it("is safe to stop twice", () => {
        const h = harness(project());

        h.stop();
        expect(() => h.stop()).not.toThrow();
    });

    /**
     * `motte serve` can start in a directory that has a config but no issues directory — before the first
     * `motte add`. Throwing there would take the server down at startup.
     */
    it("watches nothing, and does not throw, when the directories are absent", () => {
        const config = project(false);
        rmSync(config.issuesPath, { recursive: true, force: true });

        expect(harness(config).watching).toEqual([]);
    });

    /**
     * The only test here that touches the real filesystem. It covers the wiring to `fs.watch` that the
     * injected factory stands in for everywhere else, and it is retried, because whether the OS reports a
     * write promptly is not something this project controls — see the note at the top of the file.
     */
    it("observes a real write through fs.watch", { retry: 3, timeout: 25_000 }, async () => {
        const config = project();
        // Let the directory creation stop echoing: a change made just before watching started can be
        // delivered just after, which would pass this test for the wrong reason.
        await new Promise((resolve) => setTimeout(resolve, 250));

        const changes: BacklogChange[] = [];
        stops.push(watchBacklog(config, (change) => changes.push(change), { debounceMs: 50 }));

        writeFileSync(
            join(config.issuesPath, "0009-real.md"),
            "---\nid: 9\ntitle: Real\nstate: Todo\ncreated: x\nupdated: x\n---\n",
            "utf8"
        );

        const deadline = Date.now() + 18_000;
        while (changes.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(changes.flatMap((change) => change.ids)).toContain(9);
    });
});
