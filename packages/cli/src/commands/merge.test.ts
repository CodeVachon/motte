import { describe, expect, it } from "vitest";
import { padId } from "@motte/core";
import { initialised, motte } from "../testing/cli.js";

/**
 * `motte merge`, end to end.
 *
 * The store's behaviour is tested against files in core; what is checked here is the part a person
 * actually meets: that a dry run says exactly what a real run does, that the refusals arrive as one clean
 * line rather than a stack trace, and that `motte show` on a number that is gone still leads somewhere.
 */

interface Filed {
    keeper: number;
    dupe: number;
}

async function twoDuplicates(root: string): Promise<Filed> {
    const keeper = (await motte(root, ["add", "Publish the schemas", "--json"])).json<{
        id: number;
    }>().id;
    const dupe = (
        await motte(root, [
            "add",
            "Publish JSON schemas to Pages",
            "-d",
            "Filed by the other agent",
            "--plan",
            "1. Copy them into the site",
            "--json"
        ])
    ).json<{ id: number }>().id;

    return { keeper, dupe };
}

describe("motte merge", () => {
    it("folds one issue into another, leaving one issue where there were two", async () => {
        const root = await initialised();
        const { keeper, dupe } = await twoDuplicates(root);

        await motte(root, ["note", String(dupe), "Something only the duplicate knows"]);

        const merged = await motte(root, ["merge", String(dupe), String(keeper)]);

        expect(merged.code).toBe(0);
        expect(merged.stdout).toContain("merged");

        const list = (await motte(root, ["list", "--json"])).json<{ issues: { id: number }[] }>();
        expect(list.issues.map((issue) => issue.id)).toEqual([keeper]);

        const survivor = (await motte(root, ["show", String(keeper), "--json"])).json<{
            notes: { body: string }[];
        }>();
        const bodies = survivor.notes.map((note) => note.body).join("\n");

        expect(bodies).toContain("Something only the duplicate knows");
        expect(bodies).toContain("Filed by the other agent");
        expect(bodies).toContain("1. Copy them into the site");
    });

    it("accepts a title fragment on either side", async () => {
        const root = await initialised();
        const { keeper } = await twoDuplicates(root);

        expect((await motte(root, ["merge", "JSON schemas", "Publish the schemas"])).code).toBe(0);
        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: { id: number }[] }>().issues
        ).toHaveLength(1);
        expect((await motte(root, ["show", String(keeper), "--json"])).code).toBe(0);
    });

    /** The guarantee that makes a dry run worth running: it must describe the run that follows. */
    it("says the same thing in a dry run as it does for real", async () => {
        const root = await initialised();
        const { keeper, dupe } = await twoDuplicates(root);
        await motte(root, ["add", "A child", "-p", String(dupe)]);

        const dry = (
            await motte(root, ["merge", String(dupe), String(keeper), "--dry-run", "--json"])
        ).json<{
            wouldMerge: number;
            children: number[];
        }>();

        expect(dry.wouldMerge).toBe(dupe);
        expect(dry.children).toHaveLength(1);

        // Nothing happened.
        expect(
            (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
        ).toHaveLength(3);

        const real = (await motte(root, ["merge", String(dupe), String(keeper), "--json"])).json<{
            merged: number;
        }>();

        expect(real.merged).toBe(dry.wouldMerge);
    });

    it("re-parents the duplicate's children onto the survivor", async () => {
        const root = await initialised();
        const { keeper, dupe } = await twoDuplicates(root);
        const child = (await motte(root, ["add", "A child", "-p", String(dupe), "--json"])).json<{
            id: number;
        }>().id;

        await motte(root, ["merge", String(dupe), String(keeper)]);

        expect(
            (await motte(root, ["show", String(child), "--json"])).json<{ parent: number }>().parent
        ).toBe(keeper);
    });

    describe("refusals", () => {
        it("refuses a parent and its own child, in one line", async () => {
            const root = await initialised();
            const parent = (await motte(root, ["add", "Epic", "--json"])).json<{ id: number }>().id;
            const child = (
                await motte(root, ["add", "Part of it", "-p", String(parent), "--json"])
            ).json<{ id: number }>().id;

            const run = await motte(root, ["merge", String(parent), String(child)]);

            expect(run.code).not.toBe(0);
            expect(run.stderr).toContain("beneath");
            expect(run.stderr).not.toContain("MergeError:");
            // Both are still there.
            expect(
                (await motte(root, ["list", "--json"])).json<{ issues: unknown[] }>().issues
            ).toHaveLength(2);
        });

        it("refuses an issue merged into itself", async () => {
            const root = await initialised();
            const { keeper } = await twoDuplicates(root);

            const run = await motte(root, ["merge", String(keeper), String(keeper)]);

            expect(run.code).not.toBe(0);
            expect(run.stderr).toContain("itself");
        });

        it("refuses a number that does not exist", async () => {
            const root = await initialised();
            const { keeper } = await twoDuplicates(root);

            expect((await motte(root, ["merge", "999", String(keeper)])).code).not.toBe(0);
        });
    });

    /**
     * The whole reason for the tombstone. Somebody's commit message, branch name or memory still says
     * #0002, and it has to lead to the work rather than to "no issue".
     */
    describe("motte show on a merged number", () => {
        it("follows the tombstone to the issue that has the work", async () => {
            const root = await initialised();
            const { keeper, dupe } = await twoDuplicates(root);

            await motte(root, ["merge", String(dupe), String(keeper)]);

            const followed = await motte(root, ["show", String(dupe)]);

            expect(followed.code).toBe(0);
            expect(followed.stdout).toContain(`was merged into`);
            expect(followed.stdout).toContain("Publish the schemas");

            const json = (await motte(root, ["show", String(dupe), "--json"])).json<{
                id: number;
                mergedFrom: { id: number } | null;
            }>();

            expect(json.id).toBe(keeper);
            expect(json.mergedFrom?.id).toBe(dupe);
        });

        it("says nothing about a merge when the issue was never merged", async () => {
            const root = await initialised();
            const { keeper } = await twoDuplicates(root);

            const run = await motte(root, ["show", String(keeper)]);

            expect(run.stdout).not.toContain("was merged into");
            expect(
                (await motte(root, ["show", String(keeper), "--json"])).json<{
                    mergedFrom: unknown;
                }>().mergedFrom
            ).toBeNull();
        });

        /**
         * Every other command refuses — acting on the wrong issue is worse than being told a number is
         * gone — but the refusal says where it went, because otherwise the tombstone is wasted.
         */
        it("refuses elsewhere, while still saying where the number went", async () => {
            const root = await initialised();
            const { keeper, dupe } = await twoDuplicates(root);

            await motte(root, ["merge", String(dupe), String(keeper)]);

            const moved = await motte(root, ["move", String(dupe), "done"]);

            expect(moved.code).not.toBe(0);
            expect(moved.stderr).toContain(`merged into #${padId(keeper)}`);

            // And it really did not act: the survivor is untouched.
            expect(
                (await motte(root, ["show", String(keeper), "--json"])).json<{ state: string }>()
                    .state
            ).toBe("Todo");
        });

        it("says nothing extra about a number that was never merged", async () => {
            const root = await initialised();
            await twoDuplicates(root);

            expect((await motte(root, ["move", "999", "done"])).stderr).not.toContain(
                "merged into"
            );
        });

        /** A number nobody ever used must still fail, rather than resolving to something arbitrary. */
        it("still fails for a number that never existed", async () => {
            const root = await initialised();
            await twoDuplicates(root);

            expect((await motte(root, ["show", "999"])).code).not.toBe(0);
        });
    });

    it("records the merge in the log, under the number that went", async () => {
        const root = await initialised();
        const { keeper, dupe } = await twoDuplicates(root);

        await motte(root, ["merge", String(dupe), String(keeper)]);

        const entries = (await motte(root, ["log", "--json"])).json<{
            entries: { id: number; kind: string; summary: string }[];
        }>().entries;

        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: dupe, summary: `merged into #${padId(keeper)}` })
            ])
        );

        // The duplicate's earlier history stays where it was written — those events happened, under that
        // number, and the tombstone is what connects them to where the work went.
        expect(entries.filter((entry) => entry.id === dupe).length).toBeGreaterThan(1);
    });
});
