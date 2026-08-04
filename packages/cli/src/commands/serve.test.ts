import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseAssets } from "./serve.js";

/**
 * Only the part of `serve` a test can reach. The handler starts a listener and blocks until the process is
 * signalled; the server it starts is covered by `serve/server.test.ts` over a real socket.
 */
describe("chooseAssets", () => {
    it("serves from a directory when given one, in preference to anything embedded", async () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-choose-"));
        writeFileSync(join(dir, "index.html"), "<h1>built</h1>", "utf8");

        const chosen = await chooseAssets(dir);

        expect(chosen.source).toBe("directory");
        expect(String(chosen.assets("/index.html")?.body)).toBe("<h1>built</h1>");
    });

    /** Silently placeholdering a mistyped path is the most confusing outcome available. */
    it("refuses a directory that does not exist, naming it", async () => {
        await expect(chooseAssets("/no/such/place")).rejects.toThrow(/no such assets directory/);
    });

    /**
     * With no directory given it looks for the module the build writes. Whether that module exists depends on
     * whether a web build has run, and both answers are legitimate — a fresh clone has no embedded UI, a
     * released binary does — so this asserts the contract rather than one of the two outcomes.
     */
    it("falls back to the placeholder when nothing is embedded", async () => {
        const chosen = await chooseAssets(undefined);

        expect(["embedded", "placeholder"]).toContain(chosen.source);

        if (chosen.source === "placeholder") {
            expect(String(chosen.assets("/")?.body)).toContain("not built into this binary");
        } else {
            // A real build always has an entry document; the generator fails the build without one.
            expect(chosen.assets("/index.html")).toBeDefined();
        }
    });
});
