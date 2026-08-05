import { beforeEach, describe, expect, it } from "vitest";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AmbiguousRefError,
    CycleError,
    DependencyCycleError,
    IssueNotFoundError,
    IssueStore
} from "./IssueStore.js";
import { loadConfigFrom } from "./config.js";
import { DEFAULT_STATES } from "./schema/config.js";
import type { Config } from "./schema/config.js";

function project(states = DEFAULT_STATES): Config {
    const root = mkdtempSync(join(tmpdir(), "motte-test-"));
    const configPath = join(root, ".motte.config.json");
    writeFileSync(
        configPath,
        JSON.stringify({ name: "test", issuesDir: ".motte/issues", states }),
        "utf8"
    );
    return loadConfigFrom(configPath);
}

describe("IssueStore", () => {
    let config: Config;
    let store: IssueStore;

    beforeEach(() => {
        config = project();
        store = new IssueStore(config);
    });

    it("starts empty", () => {
        expect(store.all()).toEqual([]);
        expect(store.nextId()).toBe(1);
    });

    it("creates issues with sequential ids and the default state", () => {
        const first = store.create({ title: "First" });
        const second = store.create({ title: "Second" });

        expect(first.id).toBe(1);
        expect(second.id).toBe(2);
        expect(first.state).toBe("Todo");
        expect(store.all()).toHaveLength(2);
    });

    it("allocates the next id above the highest on disk, not the count", () => {
        store.create({ title: "One" });
        const second = store.create({ title: "Two" });
        store.create({ title: "Three" });

        store.remove(second.id);

        // Two files remain (#1 and #3) but the next id must be 4, never a reused 2.
        expect(store.all().map((issue) => issue.id)).toEqual([1, 3]);
        expect(store.nextId()).toBe(4);
        expect(store.create({ title: "Four" }).id).toBe(4);
    });

    it("writes a filename from the padded id and a slug of the title", () => {
        const issue = store.create({ title: "Design the Schema!" });
        expect(issue.filePath).toMatch(/0001-design-the-schema\.md$/);
    });

    it("renames the file when the title changes, keeping the id prefix", () => {
        const created = store.create({ title: "Old title" });
        const updated = store.update(created.id, { title: "New title" });

        expect(updated.filePath).toMatch(/0001-new-title\.md$/);
        expect(store.all()).toHaveLength(1);
        expect(store.all()[0]!.title).toBe("New title");
    });

    it("bumps updated but preserves created", () => {
        const created = store.create({ title: "Timestamps" });
        const updated = store.update(created.id, { title: "Changed" });

        expect(updated.created).toBe(created.created);
        expect(updated.updated >= created.updated).toBe(true);
    });

    describe("resolve", () => {
        beforeEach(() => {
            store.create({ title: "Design the schema" });
            store.create({ title: "Implement the schema loader" });
            store.create({ title: "Ship it" });
        });

        it("resolves a numeric id, with or without a leading hash", () => {
            expect(store.resolve(1).title).toBe("Design the schema");
            expect(store.resolve("2").id).toBe(2);
            expect(store.resolve("#3").id).toBe(3);
        });

        it("resolves a unique title fragment", () => {
            expect(store.resolve("ship").id).toBe(3);
            expect(store.resolve("loader").id).toBe(2);
        });

        it("throws on an ambiguous fragment, listing the candidates", () => {
            try {
                store.resolve("schema");
                expect.unreachable("should have thrown");
            } catch (thrown) {
                expect(thrown).toBeInstanceOf(AmbiguousRefError);
                expect((thrown as AmbiguousRefError).candidates).toHaveLength(2);
                expect((thrown as Error).message).toContain("#1");
                expect((thrown as Error).message).toContain("#2");
            }
        });

        it("prefers an exact title match over a substring match", () => {
            store.create({ title: "Ship" });
            expect(store.resolve("Ship").title).toBe("Ship");
        });

        it("throws when nothing matches", () => {
            expect(() => store.resolve("nonexistent")).toThrow(IssueNotFoundError);
            expect(() => store.resolve(99)).toThrow(IssueNotFoundError);
        });
    });

    describe("parents", () => {
        it("rejects a parent that does not exist", () => {
            expect(() => store.create({ title: "Orphan", parent: 42 })).toThrow(IssueNotFoundError);
        });

        it("rejects making an issue its own parent", () => {
            const issue = store.create({ title: "Self" });
            expect(() => store.setParent(issue.id, issue.id)).toThrow(CycleError);
        });

        it("rejects a parent change that would close a loop", () => {
            const root = store.create({ title: "Root" });
            const child = store.create({ title: "Child", parent: root.id });
            const grandchild = store.create({ title: "Grandchild", parent: child.id });

            expect(() => store.setParent(root.id, grandchild.id)).toThrow(CycleError);
        });

        it("clears a parent with null", () => {
            const root = store.create({ title: "Root" });
            const child = store.create({ title: "Child", parent: root.id });

            expect(store.setParent(child.id, null).parent).toBeUndefined();
        });

        it("lists children in id order", () => {
            const root = store.create({ title: "Root" });
            store.create({ title: "B", parent: root.id });
            store.create({ title: "A", parent: root.id });

            expect(store.children(root.id).map((issue) => issue.title)).toEqual(["B", "A"]);
        });
    });

    describe("createMany", () => {
        it("allocates distinct ids across the batch", () => {
            const parent = store.create({ title: "Epic" });
            const created = store.createMany(parent.id, [
                { title: "One" },
                { title: "Two" },
                { title: "Three" }
            ]);

            expect(created.map((issue) => issue.id)).toEqual([2, 3, 4]);
            expect(created.every((issue) => issue.parent === parent.id)).toBe(true);
        });
    });

    describe("notes", () => {
        it("appends notes in order and stamps the author type", () => {
            const issue = store.create({ title: "Noted" });

            store.addNote(issue.id, "From a person", { name: "Chris", type: "user" });
            const after = store.addNote(issue.id, "From a bot", { name: "atlas", type: "agent" });

            expect(after.notes).toHaveLength(2);
            expect(after.notes.map((note) => note.author.type)).toEqual(["user", "agent"]);
            expect(after.notes[0]!.body).toBe("From a person");
        });

        /**
         * Regression: `addNote` wrote to the title-derived filename without removing the old file, so
         * adding a note to an issue whose filename did not already match its title produced two files
         * with the same id. It escaped local checks and was caught by `motte doctor` in CI.
         */
        it("does not leave a second file behind when the filename does not match the title", () => {
            const created = store.create({ title: "Correct title" });

            // A hand-authored file whose name does not match its title — exactly how the real one
            // came about.
            const stale = join(config.issuesPath, "0001-some-other-name.md");
            writeFileSync(stale, readFileSync(created.filePath!, "utf8"), "utf8");
            rmSync(created.filePath!);

            const reopened = new IssueStore(config);
            reopened.addNote(1, "A note", { name: "chris", type: "user" });

            const files = readdirSync(config.issuesPath).filter((name) => name.endsWith(".md"));
            expect(files).toEqual(["0001-correct-title.md"]);
            expect(reopened.all()).toHaveLength(1);
        });

        it("survives a round-trip through disk", () => {
            const issue = store.create({ title: "Persisted" });
            store.addNote(issue.id, "Line one\n\nLine two", { name: "atlas", type: "agent" });

            const reread = new IssueStore(config).require(issue.id);
            expect(reread.notes[0]!.body).toBe("Line one\n\nLine two");
        });
    });

    describe("assignee and labels", () => {
        it("clears an assignee with null and drops the frontmatter field", () => {
            const issue = store.create({ title: "Assigned", assignee: "atlas" });
            const cleared = store.assign(issue.id, null);

            expect(cleared.assignee).toBeUndefined();
            expect(readFileSync(cleared.filePath!, "utf8")).not.toContain("assignee");
        });

        it("drops the labels field when set to an empty array", () => {
            const issue = store.create({ title: "Labelled", labels: ["core"] });
            const cleared = store.update(issue.id, { labels: [] });

            expect(cleared.labels).toBeUndefined();
            expect(readFileSync(cleared.filePath!, "utf8")).not.toContain("labels");
        });
    });

    describe("event recording", () => {
        /** A project with the log switched on, since the shared fixture disables it. */
        function logged(author?: { name: string; type: "user" | "agent" }) {
            const root = mkdtempSync(join(tmpdir(), "motte-evt-"));
            const configPath = join(root, ".motte.config.json");
            writeFileSync(
                configPath,
                JSON.stringify({ name: "t", states: DEFAULT_STATES, events: { enabled: true } }),
                "utf8"
            );
            const cfg = loadConfigFrom(configPath);
            return { config: cfg, store: new IssueStore(cfg, author) };
        }

        it("records a creation", () => {
            const { store } = logged();
            store.create({ title: "First" });

            const { events } = store.events();
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ type: "created", id: 1, title: "First" });
        });

        /**
         * The reason recording lives in the private write path rather than in each public method: a
         * mutator added later cannot forget to record.
         */
        it("records from every mutation path", () => {
            const { store } = logged();
            const first = store.create({ title: "First" });
            const second = store.create({ title: "Second" });

            store.setState(first.id, "in progress");
            store.assign(first.id, "atlas");
            store.setParent(second.id, first.id);
            store.block(second.id, first.id);
            store.unblock(second.id, first.id);
            store.update(first.id, { title: "Renamed" });
            // A note changes the file but is not a transition — its own record is in the issue.
            store.addNote(first.id, "A note", { name: "chris", type: "user" });
            store.replace(first.id, { ...store.require(first.id), state: "Done" });

            // Write order, not id order — see the sort comment in events.ts.
            const types = store.events().events.map((event) => event.type);

            expect(types).toEqual([
                "created",
                "created",
                "state",
                "assigned",
                "parent",
                "blocked",
                "unblocked",
                "title",
                "state"
            ]);
        });

        it("records nothing for a no-op write", () => {
            const { store } = logged();
            const created = store.create({ title: "Same" });
            store.setState(created.id, "Todo");

            expect(store.events().events).toHaveLength(1);
        });

        it("attributes to the author the store was given", () => {
            const { store } = logged({ name: "claude-code", type: "agent" });
            store.create({ title: "By an agent" });

            const [event] = store.events().events;
            expect(event).toMatchObject({ by: "claude-code", as: "agent" });
        });

        it("shards by the acting author, so two actors never share a file", () => {
            const project = logged({ name: "claude-code", type: "agent" });
            project.store.create({ title: "By the agent" });

            const asUser = new IssueStore(project.config, { name: "Chris", type: "user" });
            asUser.create({ title: "By a person" });

            const shards = readdirSync(join(project.config.root, ".motte", "events")).sort();

            expect(shards).toHaveLength(2);
            expect(shards.some((name) => name.includes("claude-code"))).toBe(true);
            expect(shards.some((name) => name.includes("chris"))).toBe(true);
        });

        it("records nothing when the log is disabled", () => {
            const root = mkdtempSync(join(tmpdir(), "motte-off-"));
            const configPath = join(root, ".motte.config.json");
            writeFileSync(
                configPath,
                JSON.stringify({ name: "t", states: DEFAULT_STATES, events: { enabled: false } }),
                "utf8"
            );
            const off = new IssueStore(loadConfigFrom(configPath));

            off.create({ title: "Unlogged" });

            expect(off.events().events).toEqual([]);
            expect(existsSync(join(root, ".motte", "events"))).toBe(false);
        });

        it("keeps working when the events directory cannot be written", () => {
            const { config: cfg, store: logging } = logged();
            // A file where the events directory should be, so mkdir and append both fail.
            mkdirSync(join(cfg.root, ".motte"), { recursive: true });
            writeFileSync(join(cfg.root, ".motte", "events"), "not a directory", "utf8");

            // The issue write already succeeded; a missing event is a reporting gap, not lost work.
            expect(() => logging.create({ title: "Still works" })).not.toThrow();
            expect(logging.all()).toHaveLength(1);
        });
    });

    describe("refs — headers only", () => {
        it("returns every header field, sorted by id", () => {
            store.create({ title: "Second" });
            store.create({ title: "First", labels: ["core"], assignee: "atlas" });

            const refs = store.refs();

            expect(refs.map((ref) => ref.id)).toEqual([1, 2]);
            expect(refs[1]!.assignee).toBe("atlas");
            expect(refs[1]!.labels).toEqual(["core"]);
            expect(refs[0]!.filePath).toMatch(/0001-second\.md$/);
        });

        it("agrees with all() on every header field", () => {
            store.create({ title: "Parent" });
            store.create({ title: "Child", parent: 1, labels: ["a", "b"], assignee: "chris" });
            store.block(2, 1);

            const refs = new IssueStore(config).refs();
            const issues = new IssueStore(config).all();

            for (const issue of issues) {
                const ref = refs.find((candidate) => candidate.id === issue.id)!;
                expect(ref.title).toBe(issue.title);
                expect(ref.state).toBe(issue.state);
                expect(ref.parent).toBe(issue.parent);
                expect(ref.assignee).toBe(issue.assignee);
                expect(ref.labels).toEqual(issue.labels);
                expect(ref.blockedBy).toEqual(issue.blockedBy);
            }
        });

        it("skips an unparseable file silently rather than throwing", () => {
            store.create({ title: "Good" });
            writeFileSync(join(config.issuesPath, "0099-bad.md"), "not an issue\n", "utf8");

            // Completion runs on every TAB — it must never spill an error into the shell.
            expect(() => store.refs()).not.toThrow();
            expect(store.refs().map((ref) => ref.id)).toEqual([1]);
        });

        it("ignores files that are not markdown", () => {
            store.create({ title: "Good" });
            writeFileSync(join(config.issuesPath, "notes.txt"), "ignore\n", "utf8");

            expect(store.refs()).toHaveLength(1);
        });

        it("returns nothing when the issues directory does not exist", () => {
            const empty = project();
            rmSync(empty.issuesPath, { recursive: true, force: true });

            expect(new IssueStore(empty).refs()).toEqual([]);
        });

        it("reuses an already-parsed issue instead of re-reading the file", () => {
            const created = store.create({ title: "Cached", description: "Body." });

            // Pin the mtime to a whole second so it can be restored exactly. statSync exposes
            // sub-millisecond precision that utimesSync cannot round-trip from a Date.
            const pinned = new Date(Math.floor(Date.now() / 1000) * 1000);
            utimesSync(created.filePath!, pinned, pinned);

            store.all();
            expect(statSync(created.filePath!).mtimeMs).toBe(pinned.getTime());

            // Rewrite the file, then restore the mtime so the cache still considers itself valid.
            // A refs() that re-read the file would say "Rewritten"; one honouring the cache returns
            // the parse it already holds.
            writeFileSync(
                created.filePath!,
                readFileSync(created.filePath!, "utf8").replace(
                    "title: Cached",
                    "title: Rewritten"
                ),
                "utf8"
            );
            utimesSync(created.filePath!, pinned, pinned);

            expect(store.refs()[0]!.title).toBe("Cached");
        });

        it("sees a change made on disk behind its back", () => {
            const created = store.create({ title: "Before" });
            expect(store.refs()[0]!.title).toBe("Before");

            const raw = readFileSync(created.filePath!, "utf8").replace(
                "title: Before",
                "title: After"
            );
            rmSync(created.filePath!);
            writeFileSync(created.filePath!, raw, "utf8");

            expect(new IssueStore(config).refs()[0]!.title).toBe("After");
        });

        it("does not care how large the bodies are", () => {
            const created = store.create({ title: "Fat" });
            const raw = readFileSync(created.filePath!, "utf8");
            writeFileSync(created.filePath!, `${raw}\n${"x".repeat(200_000)}\n`, "utf8");

            expect(store.refs()[0]!.title).toBe("Fat");
        });
    });

    describe("replace — the $EDITOR path", () => {
        it("applies everything the editor changed, including notes and unknown sections", () => {
            const created = store.create({ title: "Before", description: "Old." });

            const edited = {
                ...created,
                title: "After",
                state: "In Progress",
                description: "New.",
                notes: [
                    {
                        at: "2026-07-29T12:00:00Z",
                        author: { name: "chris", type: "user" as const },
                        body: "Hand-written."
                    }
                ],
                unknownSections: [
                    { heading: "Risks", body: "A risk.", after: "description" as const }
                ]
            };

            const written = store.replace(created.id, edited);

            expect(written.title).toBe("After");
            expect(written.state).toBe("In Progress");
            expect(written.notes).toHaveLength(1);
            expect(written.unknownSections[0]!.heading).toBe("Risks");
            expect(readFileSync(written.filePath!, "utf8")).toContain("## Risks");
        });

        it("keeps id and created from disk, ignoring what the editor said", () => {
            const created = store.create({ title: "Identity" });

            const written = store.replace(created.id, {
                ...created,
                id: 999,
                created: "1999-01-01T00:00:00Z"
            });

            // Identity is not content — an edited id or created date must not fork the issue.
            expect(written.id).toBe(created.id);
            expect(written.created).toBe(created.created);
        });

        it("bumps updated even when the editor left the timestamp alone", () => {
            const created = store.create({ title: "Stamp" });

            const written = store.replace(created.id, { ...created, description: "Changed." });

            expect(written.updated >= created.updated).toBe(true);
            expect(readFileSync(written.filePath!, "utf8")).toContain(
                `updated: ${written.updated}`
            );
        });

        it("renames the file when the title changed and removes the old one", () => {
            const created = store.create({ title: "Old name" });
            const written = store.replace(created.id, { ...created, title: "New name" });

            expect(written.filePath).toMatch(/0001-new-name\.md$/);
            expect(store.all()).toHaveLength(1);
        });

        it("rejects an unknown state", () => {
            const created = store.create({ title: "Bad state" });
            expect(() => store.replace(created.id, { ...created, state: "Shipped" })).toThrow(
                /not a known state/
            );
        });

        it("rejects a blocker that does not exist", () => {
            const created = store.create({ title: "Bad blocker" });
            expect(() => store.replace(created.id, { ...created, blockedBy: [42] })).toThrow(
                IssueNotFoundError
            );
        });

        it("rejects a parent that would create a cycle", () => {
            const root = store.create({ title: "Root" });
            const child = store.create({ title: "Child", parent: root.id });

            expect(() => store.replace(root.id, { ...root, parent: child.id })).toThrow(CycleError);
        });

        it("rejects a dependency cycle", () => {
            const first = store.create({ title: "First" });
            const second = store.create({ title: "Second" });
            store.block(second.id, first.id);

            expect(() => store.replace(first.id, { ...first, blockedBy: [second.id] })).toThrow(
                DependencyCycleError
            );
        });

        it("drops emptied labels and blockers rather than writing empty arrays", () => {
            const created = store.create({ title: "Emptied", labels: ["core"] });

            const written = store.replace(created.id, { ...created, labels: [], blockedBy: [] });

            expect(written.labels).toBeUndefined();
            expect(written.blockedBy).toBeUndefined();
            const raw = readFileSync(written.filePath!, "utf8");
            expect(raw).not.toContain("labels");
            expect(raw).not.toContain("blockedBy");
        });
    });

    describe("blockers", () => {
        it("records and clears a blocker, dropping the frontmatter field when empty", () => {
            const blocker = store.create({ title: "First" });
            const dependent = store.create({ title: "Second" });

            const blockedIssue = store.block(dependent.id, blocker.id);
            expect(blockedIssue.blockedBy).toEqual([blocker.id]);
            expect(readFileSync(blockedIssue.filePath!, "utf8")).toContain("blockedBy: [1]");

            const cleared = store.unblock(dependent.id, blocker.id);
            expect(cleared.blockedBy).toBeUndefined();
            expect(readFileSync(cleared.filePath!, "utf8")).not.toContain("blockedBy");
        });

        it("is idempotent in both directions", () => {
            const blocker = store.create({ title: "First" });
            const dependent = store.create({ title: "Second" });

            store.block(dependent.id, blocker.id);
            expect(store.block(dependent.id, blocker.id).blockedBy).toEqual([blocker.id]);

            store.unblock(dependent.id, blocker.id);
            expect(store.unblock(dependent.id, blocker.id).blockedBy).toBeUndefined();
        });

        it("rejects a blocker that does not exist", () => {
            const issue = store.create({ title: "Only" });
            expect(() => store.block(issue.id, 99)).toThrow(IssueNotFoundError);
        });

        it("rejects a self-block and a cycle", () => {
            const first = store.create({ title: "First" });
            const second = store.create({ title: "Second" });

            expect(() => store.block(first.id, first.id)).toThrow(DependencyCycleError);

            store.block(second.id, first.id);
            expect(() => store.block(first.id, second.id)).toThrow(DependencyCycleError);
        });

        it("sorts and de-duplicates blockers on write so merges converge", () => {
            store.create({ title: "A" });
            store.create({ title: "B" });
            const dependent = store.create({ title: "C" });

            const written = store.update(dependent.id, { blockedBy: [2, 1, 2] });
            expect(readFileSync(written.filePath!, "utf8")).toContain("blockedBy: [1, 2]");
        });

        it("derives the inverse without storing it", () => {
            const blocker = store.create({ title: "Blocker" });
            const a = store.create({ title: "A" });
            const b = store.create({ title: "B" });

            store.block(a.id, blocker.id);
            store.block(b.id, blocker.id);

            expect(store.blocks(blocker.id).map((x) => x.id)).toEqual([a.id, b.id]);
            // The blocker's own file says nothing about what it blocks.
            expect(readFileSync(store.require(blocker.id).filePath!, "utf8")).not.toContain(
                "blocks"
            );
        });

        it("moves an issue from blocked to ready when its blocker completes", () => {
            const blocker = store.create({ title: "Blocker" });
            const dependent = store.create({ title: "Dependent" });
            store.block(dependent.id, blocker.id);

            expect(store.ready().map((x) => x.id)).toEqual([blocker.id]);
            expect(store.blocked().map((x) => x.id)).toEqual([dependent.id]);

            store.setState(blocker.id, "done");

            expect(store.ready().map((x) => x.id)).toEqual([dependent.id]);
            expect(store.blocked()).toEqual([]);
        });

        it("survives a round-trip through disk", () => {
            store.create({ title: "A" });
            store.create({ title: "B" });
            const dependent = store.create({ title: "C" });
            store.update(dependent.id, { blockedBy: [1, 2] });

            expect(new IssueStore(config).require(dependent.id).blockedBy).toEqual([1, 2]);
        });

        it("allows blockers that cross the parent hierarchy", () => {
            const epicA = store.create({ title: "Epic A" });
            const epicB = store.create({ title: "Epic B" });
            const childOfA = store.create({ title: "Child of A", parent: epicA.id });
            const childOfB = store.create({ title: "Child of B", parent: epicB.id });

            // The whole point: a dependency the tree cannot express.
            expect(() => store.block(childOfB.id, childOfA.id)).not.toThrow();
            expect(store.require(childOfB.id).blockedBy).toEqual([childOfA.id]);
        });
    });

    describe("broken files", () => {
        it("reports an unparseable file without failing the whole read", () => {
            store.create({ title: "Good" });
            writeFileSync(join(config.issuesPath, "0099-bad.md"), "not an issue\n", "utf8");

            expect(store.all()).toHaveLength(1);
            expect(store.brokenFiles()).toHaveLength(1);
            expect(store.brokenFiles()[0]!.filePath).toMatch(/0099-bad\.md$/);
        });

        it("ignores files that are not markdown", () => {
            store.create({ title: "Good" });
            writeFileSync(join(config.issuesPath, "notes.txt"), "ignore me\n", "utf8");

            expect(store.all()).toHaveLength(1);
            expect(store.brokenFiles()).toHaveLength(0);
        });
    });

    describe("round-trip integrity", () => {
        it("says nothing about files it wrote itself", () => {
            store.create({ title: "Written by us", labels: ["core", "cli"] });
            store.create({ title: "Also ours" });

            expect(store.notRoundTrippable()).toEqual([]);
        });

        /**
         * The escape that motivated this check. A comma inside an unquoted inline-list item parses as
         * two labels and re-serialises as one quoted item, so the file parses cleanly while no longer
         * matching what the writer would produce.
         */
        it("reports a file that would be reformatted if written back", () => {
            const issue = store.create({ title: "Has labels", labels: ["core"] });
            writeFileSync(
                issue.filePath!,
                readFileSync(issue.filePath!, "utf8").replace(
                    "labels: [core]",
                    "labels: [core,cli]"
                ),
                "utf8"
            );

            const found = store.notRoundTrippable();
            expect(found).toHaveLength(1);
            expect(found[0]!.id).toBe(issue.id);
            // Parseable, so it is not a broken file — which is exactly why it needed its own check.
            expect(store.brokenFiles()).toEqual([]);
        });

        it("reports a value quoted where the writer would not quote it", () => {
            // Semantically identical and perfectly valid YAML, but not what `formatIssueFile` emits,
            // so an unrelated write would silently rewrite the line.
            const issue = store.create({ title: "Plain" });
            writeFileSync(
                issue.filePath!,
                readFileSync(issue.filePath!, "utf8").replace("title: Plain", 'title: "Plain"'),
                "utf8"
            );

            expect(store.notRoundTrippable().map((found) => found.id)).toEqual([issue.id]);
            expect(store.require(issue.id).title).toBe("Plain");
        });
    });

    it("picks up a change made on disk behind its back", () => {
        const issue = store.create({ title: "Watched" });
        expect(store.require(issue.id).title).toBe("Watched");

        const raw = readFileSync(issue.filePath!, "utf8").replace(
            "title: Watched",
            "title: Changed underneath"
        );
        // Push the mtime forward so the change is visible even on a coarse-grained filesystem.
        rmSync(issue.filePath!);
        writeFileSync(issue.filePath!, raw, "utf8");

        expect(new IssueStore(config).require(issue.id).title).toBe("Changed underneath");
    });

    it("honours a custom state list", () => {
        const custom = project([
            { name: "Backlog", category: "unstarted" },
            { name: "Doing", category: "started" },
            { name: "Shipped", category: "completed" }
        ]);
        const customStore = new IssueStore(custom);

        expect(customStore.create({ title: "Custom" }).state).toBe("Backlog");
        expect(customStore.setState(1, "ship").state).toBe("Shipped");
    });

    /**
     * Renumbering a file, which is the only mutator addressed by path rather than by id.
     *
     * It has to be: the only reason to call it is that two files claim one id, which is exactly when
     * `require(id)` cannot tell them apart.
     */
    describe("renumberFile", () => {
        /** Two files claiming #7, the way a merge of two branches leaves them. */
        function duplicate(): { keeper: string; mover: string } {
            const dir = config.issuesPath;
            mkdirSync(dir, { recursive: true });

            const keeper = join(dir, "0007-filed-first.md");
            const mover = join(dir, "0007-filed-second.md");

            writeFileSync(
                keeper,
                "---\nid: 7\ntitle: Filed first\nstate: Todo\ncreated: 2026-08-01T09:00:00Z\n" +
                    "updated: 2026-08-01T09:00:00Z\n---\n\n## Description\n\nBranch A.\n",
                "utf8"
            );
            writeFileSync(
                mover,
                "---\nid: 7\ntitle: Filed second\nstate: In Progress\ncreated: 2026-08-02T09:00:00Z\n" +
                    "updated: 2026-08-02T09:00:00Z\n---\n\n## Description\n\nBranch B.\n",
                "utf8"
            );

            return { keeper, mover };
        }

        it("moves the file it was given and leaves the other alone", () => {
            const { keeper, mover } = duplicate();

            const renumbered = store.renumberFile(mover, 10);

            expect(renumbered.id).toBe(10);
            expect(existsSync(mover)).toBe(false);
            expect(existsSync(keeper)).toBe(true);
            expect(existsSync(join(config.issuesPath, "0010-filed-second.md"))).toBe(true);
            expect(new IssueStore(config).require(7).title).toBe("Filed first");
        });

        it("keeps everything except the id, and records where the number came from", () => {
            const { mover } = duplicate();

            const renumbered = store.renumberFile(mover, 10);

            expect(renumbered.title).toBe("Filed second");
            expect(renumbered.state).toBe("In Progress");
            // `created` is identity: the issue was filed when it was filed, whatever it is called now.
            expect(renumbered.created).toBe("2026-08-02T09:00:00Z");
            expect(renumbered.notes.at(-1)?.body).toMatch(/Renumbered from #0007/);
        });

        it("attributes the note the way every other note is attributed", () => {
            const { mover } = duplicate();

            const renumbered = store.renumberFile(mover, 10, { name: "atlas", type: "agent" });

            expect(renumbered.notes.at(-1)?.author).toEqual({ name: "atlas", type: "agent" });
        });

        it("refuses an id that is already taken rather than making a second collision", () => {
            const { mover } = duplicate();

            expect(() => store.renumberFile(mover, 7)).toThrow(/already in use/);
            expect(existsSync(mover)).toBe(true);
        });

        it("leaves the backlog with no duplicates, which is the point", () => {
            const { mover } = duplicate();

            store.renumberFile(mover, 10);

            const ids = new IssueStore(config).all().map((issue) => issue.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});
