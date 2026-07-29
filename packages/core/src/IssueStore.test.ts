import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
