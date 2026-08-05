import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATES, type Config, type Issue, type Snapshot } from "@motte/core";
import { startWatch, type Screen } from "./run.js";

/**
 * The watch loop.
 *
 * Every dependency is injected, which is what makes the interesting cases reachable: a read that throws,
 * a resize, a pipe instead of a terminal, and stopping actually stopping. None of that can be driven
 * through a real filesystem watcher and a real terminal from a test.
 */

const config: Config = {
    name: "Test Project",
    issuesDir: ".motte/issues",
    states: DEFAULT_STATES,
    defaultState: "Todo",
    root: "/nowhere",
    configPath: "/nowhere/.motte.config.json",
    issuesPath: "/nowhere/.motte/issues",
    events: { enabled: true }
};

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "Write the parser",
        state: "Todo",
        created: "2026-08-01T09:00:00Z",
        updated: "2026-08-01T09:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

function snapshot(issues: Issue[]): Snapshot {
    return { issues, events: [] };
}

/** A screen that records what was written, and can pretend to be resized. */
function fakeScreen(rows = 24, columns = 80) {
    const written: string[] = [];
    let onResize: (() => void) | undefined;

    const screen: Screen = {
        columns,
        rows,
        write: (text) => written.push(text),
        onResize: (handler) => {
            onResize = handler;
            return () => {
                onResize = undefined;
            };
        }
    };

    return {
        screen,
        written,
        all: () => written.join(""),
        resize: () => onResize?.(),
        stillSubscribed: () => onResize !== undefined
    };
}

/** A backlog that returns each queued reading in turn, holding the last one. */
function fakeReads(readings: Snapshot[]) {
    let index = 0;
    let calls = 0;

    return {
        read: (): Snapshot => {
            calls += 1;
            const reading = readings[Math.min(index, readings.length - 1)]!;
            index += 1;
            return reading;
        },
        calls: () => calls
    };
}

let watcher: { trigger: () => void; stopped: boolean };

function fakeWatch() {
    watcher = { trigger: () => undefined, stopped: false };

    return (onChange: () => void) => {
        watcher.trigger = onChange;
        return () => {
            watcher.stopped = true;
        };
    };
}

describe("in a terminal", () => {
    it("draws a frame at once, before anything has changed", () => {
        const screen = fakeScreen();
        const reads = fakeReads([snapshot([issue()])]);

        const running = startWatch(config, {
            read: reads.read,
            watch: fakeWatch(),
            screen: screen.screen,
            tty: true
        });

        expect(screen.all()).toContain("Test Project");
        // The baseline reports nothing: what is already on disk is not news.
        expect(screen.all()).toContain("waiting");
        running.stop();
    });

    it("takes the alternate screen buffer and gives it back on stop", () => {
        const screen = fakeScreen();

        const running = startWatch(config, {
            read: fakeReads([snapshot([issue()])]).read,
            watch: fakeWatch(),
            screen: screen.screen,
            tty: true
        });

        expect(screen.all()).toContain("[?1049h");
        expect(screen.all()).not.toContain("[?1049l");

        running.stop();

        // The one thing that must always happen: a shell left in the alternate buffer with no cursor is
        // worse than no dashboard.
        expect(screen.all()).toContain("[?1049l");
        expect(screen.all()).toContain("[?25h");
    });

    it("redraws with the change when the watcher fires", () => {
        const screen = fakeScreen();
        const watch = fakeWatch();

        const running = startWatch(config, {
            read: fakeReads([
                snapshot([issue()]),
                snapshot([issue({ state: "In Progress", updated: "2026-08-02T14:00:00Z" })])
            ]).read,
            watch,
            screen: screen.screen,
            tty: true
        });

        watcher.trigger();

        expect(screen.all()).toContain("In Progress");
        expect(screen.all()).toContain("14:00");
        running.stop();
    });

    it("redraws on a resize without re-reading the backlog", () => {
        const screen = fakeScreen();
        const reads = fakeReads([snapshot([issue()])]);

        const running = startWatch(config, {
            read: reads.read,
            watch: fakeWatch(),
            screen: screen.screen,
            tty: true
        });

        const before = reads.calls();
        const frames = screen.written.length;

        screen.resize();

        expect(screen.written.length).toBeGreaterThan(frames);
        // A resize changes the window, not the backlog.
        expect(reads.calls()).toBe(before);
        running.stop();
    });
});

describe("in a pipe", () => {
    it("writes one line per change and no terminal control at all", () => {
        const screen = fakeScreen();
        const watch = fakeWatch();

        const running = startWatch(config, {
            read: fakeReads([
                snapshot([issue()]),
                snapshot([issue({ state: "In Progress", updated: "2026-08-02T14:00:00Z" })])
            ]).read,
            watch,
            screen: screen.screen,
            tty: false
        });

        watcher.trigger();

        const out = screen.all();
        expect(out).toContain("In Progress");
        // What makes `motte watch | tee` work: no cursor moves, no clears, no alternate buffer.
        expect(out).not.toContain("[");
        expect(out.trimEnd().split("\n")).toHaveLength(1);
        running.stop();
    });

    it("says nothing at all until something changes", () => {
        const screen = fakeScreen();

        const running = startWatch(config, {
            read: fakeReads([snapshot([issue()])]).read,
            watch: fakeWatch(),
            screen: screen.screen,
            tty: false
        });

        expect(screen.all()).toBe("");
        running.stop();
    });
});

describe("a read that fails", () => {
    it("shows the problem rather than dying", () => {
        const screen = fakeScreen();

        // A file can be caught mid-rename; a dashboard that exits the first time it sees that is useless.
        const running = startWatch(config, {
            read: () => {
                throw new Error("unexpected end of input");
            },
            watch: fakeWatch(),
            screen: screen.screen,
            tty: true
        });

        expect(screen.all()).toContain("could not read the backlog");
        expect(screen.all()).toContain("unexpected end of input");
        running.stop();
    });

    it("clears the problem when the next read works", () => {
        const screen = fakeScreen();
        const watch = fakeWatch();
        let fail = true;

        const running = startWatch(config, {
            read: () => {
                if (fail) throw new Error("mid-write");
                return snapshot([issue()]);
            },
            watch,
            screen: screen.screen,
            tty: true
        });

        fail = false;
        screen.written.length = 0;
        watcher.trigger();

        expect(screen.all()).not.toContain("could not read");
        running.stop();
    });
});

describe("polling instead of watching", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("re-reads on the interval", () => {
        const screen = fakeScreen();
        const reads = fakeReads([snapshot([issue()])]);

        const running = startWatch(config, {
            read: reads.read,
            intervalMs: 1000,
            screen: screen.screen,
            tty: true
        });

        expect(reads.calls()).toBe(1);

        vi.advanceTimersByTime(3000);

        expect(reads.calls()).toBe(4);
        running.stop();
    });

    it("stops polling when stopped", () => {
        const screen = fakeScreen();
        const reads = fakeReads([snapshot([issue()])]);

        const running = startWatch(config, {
            read: reads.read,
            intervalMs: 1000,
            screen: screen.screen,
            tty: true
        });

        running.stop();
        const after = reads.calls();
        vi.advanceTimersByTime(10_000);

        expect(reads.calls()).toBe(after);
    });
});

describe("stopping", () => {
    it("unsubscribes from the watcher and the resize", () => {
        const screen = fakeScreen();
        const watch = fakeWatch();

        const running = startWatch(config, {
            read: fakeReads([snapshot([issue()])]).read,
            watch,
            screen: screen.screen,
            tty: true
        });

        running.stop();

        expect(watcher.stopped).toBe(true);
        expect(screen.stillSubscribed()).toBe(false);
    });

    it("is safe to call twice, which happens when a signal and exit both fire", () => {
        const screen = fakeScreen();

        const running = startWatch(config, {
            read: fakeReads([snapshot([issue()])]).read,
            watch: fakeWatch(),
            screen: screen.screen,
            tty: true
        });

        running.stop();
        const once = screen.all();
        running.stop();

        // Restoring twice would write the escape twice, which is harmless but says the guard is missing.
        expect(screen.all()).toBe(once);
    });

    it("ignores a change that arrives after stopping", () => {
        const screen = fakeScreen();
        const watch = fakeWatch();

        const running = startWatch(config, {
            read: fakeReads([snapshot([issue()]), snapshot([issue({ state: "Done" })])]).read,
            watch,
            screen: screen.screen,
            tty: false
        });

        running.stop();
        watcher.trigger();

        expect(screen.all()).not.toContain("Done");
    });
});

describe("history", () => {
    it("keeps only the most recent changes, so a long session cannot grow without limit", () => {
        const screen = fakeScreen(100);
        const watch = fakeWatch();
        let state = 0;

        const running = startWatch(config, {
            // Each read renames the issue, so every trigger produces exactly one change.
            read: () => {
                state += 1;
                return snapshot([issue({ title: `Title ${state}` })]);
            },
            watch,
            screen: screen.screen,
            tty: true,
            keep: 3
        });

        for (let i = 0; i < 6; i += 1) watcher.trigger();

        const frame = screen.written.at(-1) ?? "";
        expect(frame).toContain("Title 7");
        expect(frame).not.toContain("Title 3 ");
        running.stop();
    });
});
