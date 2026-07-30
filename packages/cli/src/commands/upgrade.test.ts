import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.js";
import { motte, project } from "../testing/cli.js";

/**
 * `motte upgrade --check` against a faked managed installation.
 *
 * The handler was at 0% coverage with a CRAP of 182. Everything up to the download is reachable without one:
 * `locateInstall` derives the install from `process.execPath`, which can be pointed at a directory laid out
 * the way the installer lays one out, and `resolveLatestVersion` goes through global `fetch`.
 *
 * The download itself is deliberately not exercised here. Its seam is `fetchVerifiedBinary`, which
 * `download.test.ts` already covers against a local HTTP server, and driving a real install would mean
 * writing a fake binary and repointing symlinks for very little added confidence.
 */

const original = process.execPath;

/**
 * Lay out `~/.motte/versions/<version>/bin/motte` and point `process.execPath` at it.
 *
 * That path shape is the whole of what makes an install "managed": `locateInstall` walks up from the binary
 * and requires `bin` then `versions`, so anything else reads as running from source.
 */
function managedInstall(version = `v${VERSION}`, others: string[] = []): string {
    const root = mkdtempSync(join(tmpdir(), "motte-install-"));

    for (const dir of [version, ...others]) {
        mkdirSync(join(root, "versions", dir, "bin"), { recursive: true });
        writeFileSync(join(root, "versions", dir, "bin", "motte"), "#!/bin/sh\n", "utf8");
    }

    Object.defineProperty(process, "execPath", {
        value: join(root, "versions", version, "bin", "motte"),
        configurable: true,
        writable: true
    });

    return root;
}

function stubLatest(tag: string): void {
    vi.stubGlobal("fetch", () =>
        Promise.resolve({
            status: 200,
            text: () => Promise.resolve(JSON.stringify({ tag_name: tag }))
        })
    );
}

afterEach(() => {
    Object.defineProperty(process, "execPath", {
        value: original,
        configurable: true,
        writable: true
    });
    vi.unstubAllGlobals();
});

describe("upgrade --check", () => {
    it("reports being up to date when the newest release is the running version", async () => {
        managedInstall();
        stubLatest(`v${VERSION}`);

        const json = (await motte(project(), ["upgrade", "--check", "--json"])).json<{
            current: string;
            latest: string;
            upToDate: boolean;
            isDowngrade: boolean;
        }>();

        expect(json.upToDate).toBe(true);
        expect(json.isDowngrade).toBe(false);
        expect(json.latest).toBe(json.current);
    });

    it("reports an available upgrade", async () => {
        managedInstall();
        stubLatest("v99.0.0");

        const run = await motte(project(), ["upgrade", "--check"]);
        const json = (await motte(project(), ["upgrade", "--check", "--json"])).json<{
            upToDate: boolean;
            latest: string;
        }>();

        expect(json.upToDate).toBe(false);
        expect(json.latest).toBe("v99.0.0");
        expect(run.stdout).toMatch(/99\.0\.0 is available/);
    });

    /**
     * A named older version is a downgrade, not a no-op. String equality would have missed the distinction,
     * which is why the handler compares semantically.
     */
    it("recognises an explicitly named older version as a downgrade", async () => {
        managedInstall();

        const json = (await motte(project(), ["upgrade", "0.0.1", "--check", "--json"])).json<{
            upToDate: boolean;
            isDowngrade: boolean;
        }>();

        expect(json.isDowngrade).toBe(true);
        expect(json.upToDate).toBe(false);
    });

    /** Passing a version skips the lookup entirely, so an unreachable API must not matter. */
    it("does not consult the API when given a version", async () => {
        managedInstall();
        const fetched = vi.fn(() => Promise.reject(new Error("should not be called")));
        vi.stubGlobal("fetch", fetched);

        const run = await motte(project(), ["upgrade", "0.0.1", "--check"]);

        expect(run.code).toBe(0);
        expect(fetched).not.toHaveBeenCalled();
    });

    it("accepts a version with or without a leading v", async () => {
        managedInstall();

        for (const given of ["9.9.9", "v9.9.9"]) {
            const json = (await motte(project(), ["upgrade", given, "--check", "--json"])).json<{
                latest: string;
            }>();
            expect(json.latest).toBe("v9.9.9");
        }
    });

    it("lists the versions present in the install root", async () => {
        managedInstall(`v${VERSION}`, ["v0.0.1", "v0.0.2"]);
        stubLatest(`v${VERSION}`);

        const json = (await motte(project(), ["upgrade", "--check", "--json"])).json<{
            installed: string[];
            installRoot: string;
        }>();

        expect(json.installed).toContain("v0.0.1");
        expect(json.installed).toContain("v0.0.2");
        expect(json.installRoot).toContain("motte-install-");
    });

    it("surfaces a failed release lookup rather than reporting a bogus version", async () => {
        managedInstall();
        vi.stubGlobal("fetch", () =>
            Promise.resolve({ status: 500, text: () => Promise.resolve("boom") })
        );

        const run = await motte(project(), ["upgrade", "--check"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/listing releases|could not reach/);
    });

    /**
     * Running from source is the common case for a contributor, and the message has to say what to do
     * instead rather than looking like a crash.
     */
    it("explains itself when not running from a managed install", async () => {
        const run = await motte(project(), ["upgrade", "--check"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/managed installation/);
    });
});

describe("a release tag without a leading v", () => {
    /**
     * `normalizeVersion` adds the `v`, and every internal comparison assumes it: the regex in
     * `compareVersionsDescending` is anchored on `^v`. An explicitly passed version goes through
     * `normalizeVersion`, but the tag from `resolveLatestVersion` does not, so a release tagged `0.3.0`
     * instead of `v0.3.0` would compare as 0.0.0 against 0.0.0 and read as up to date.
     *
     * Every tag so far is v-prefixed, so this has never bitten. Written as a test to find out whether the
     * gap is real rather than assuming from a reading of the code.
     */
    it("is still recognised as newer than the running version", async () => {
        managedInstall();
        stubLatest("99.0.0");

        const json = (await motte(project(), ["upgrade", "--check", "--json"])).json<{
            upToDate: boolean;
            latest: string;
            isDowngrade: boolean;
        }>();

        expect(json.upToDate).toBe(false);
        // The assertion that matters: 99 is newer, so this must not read as a downgrade.
        expect(json.isDowngrade).toBe(false);
        expect(json.latest).toBe("v99.0.0");
    });
});

describe("upgrade without --check", () => {
    /** The one path that stops before any download: already on the newest version. */
    it("stops when already up to date, and says how to override", async () => {
        managedInstall();
        stubLatest(`v${VERSION}`);

        const run = await motte(project(), ["upgrade"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/already on/);
        expect(run.stdout).toMatch(/--force/);
    });
});
