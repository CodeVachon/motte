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
    it("falls back to the placeholder when no directory is given", () => {
        const lookup = chooseAssets(undefined);

        expect(lookup("/")?.type).toMatch(/text\/html/);
        expect(String(lookup("/")?.body)).toContain("has not been built yet");
    });

    it("serves from a directory that exists", () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-choose-"));
        writeFileSync(join(dir, "index.html"), "<h1>built</h1>", "utf8");

        expect(String(chooseAssets(dir)("/index.html")?.body)).toBe("<h1>built</h1>");
    });

    /** Silently placeholdering a mistyped path is the most confusing outcome available. */
    it("refuses a directory that does not exist, naming it", () => {
        expect(() => chooseAssets("/no/such/place")).toThrow(/no such assets directory/);
    });
});
