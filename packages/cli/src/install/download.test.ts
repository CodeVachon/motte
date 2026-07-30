import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadError, fetchVerifiedBinary, installBinary, pruneVersions } from "./download.js";
import { hostTarget } from "./layout.js";

describe("pruneVersions", () => {
    function versions(...names: string[]): string {
        const dir = mkdtempSync(join(tmpdir(), "motte-prune-"));
        for (const name of names) mkdirSync(join(dir, name, "bin"), { recursive: true });
        return dir;
    }

    it("keeps the newest N and removes the rest", () => {
        const dir = versions("v0.3.0", "v0.2.0", "v0.1.0");
        const result = pruneVersions(dir, ["v0.3.0", "v0.2.0", "v0.1.0"], 2, "v0.3.0");

        expect(result.removed).toEqual(["v0.1.0"]);
        expect(existsSync(join(dir, "v0.3.0"))).toBe(true);
        expect(existsSync(join(dir, "v0.2.0"))).toBe(true);
        expect(existsSync(join(dir, "v0.1.0"))).toBe(false);
    });

    it("never removes the running version, and reports keeping it", () => {
        const dir = versions("v0.3.0", "v0.1.0");
        // Deleting a running executable fails outright on Windows, so the guard is not optional.
        const result = pruneVersions(dir, ["v0.3.0", "v0.1.0"], 1, "v0.1.0");

        expect(result.removed).toEqual([]);
        expect(result.keptRunning).toBe("v0.1.0");
        // Silently ignoring --keep would look like the flag did nothing.
        expect(existsSync(join(dir, "v0.1.0"))).toBe(true);
    });

    it("removes the old version once it is no longer the one running", () => {
        const dir = versions("v0.3.0", "v0.1.0");
        const result = pruneVersions(dir, ["v0.3.0", "v0.1.0"], 1, "v0.3.0");

        expect(result.removed).toEqual(["v0.1.0"]);
        expect(result.keptRunning).toBeUndefined();
    });

    it("removes nothing when there is nothing beyond the keep count", () => {
        const dir = versions("v0.1.0");
        expect(pruneVersions(dir, ["v0.1.0"], 2, "v0.1.0").removed).toEqual([]);
    });

    it("treats keep 0 as keep 1, so an install is never left empty", () => {
        const dir = versions("v0.3.0", "v0.1.0");
        const result = pruneVersions(dir, ["v0.3.0", "v0.1.0"], 0, "v0.3.0");

        expect(result.removed).toEqual(["v0.1.0"]);
        expect(existsSync(join(dir, "v0.3.0"))).toBe(true);
    });
});

describe("installBinary", () => {
    it("writes the binary, makes it executable, and points current at it", () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "motte-install-")));
        const path = installBinary(root, "0.2.0", new TextEncoder().encode("#!/bin/sh\n"), false);

        expect(path).toBe(join(root, "versions", "v0.2.0", "bin", "motte"));
        expect(readFileSync(path, "utf8")).toBe("#!/bin/sh\n");
        // 0o111 — executable by someone.
        expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
        expect(realpathSync(join(root, "current"))).toBe(join(root, "versions", "v0.2.0"));
    });

    it("accepts a version with or without the leading v", () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "motte-install-")));
        installBinary(root, "v0.2.0", new Uint8Array([1]), false);

        expect(existsSync(join(root, "versions", "v0.2.0", "bin", "motte"))).toBe(true);
    });

    it("repoints current when it already exists", () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "motte-install-")));
        installBinary(root, "0.1.0", new Uint8Array([1]), false);
        installBinary(root, "0.2.0", new Uint8Array([2]), false);

        // Repointing current is what makes a new version take effect, since ~/.local/bin points here.
        expect(realpathSync(join(root, "current"))).toBe(join(root, "versions", "v0.2.0"));
        expect(existsSync(join(root, "versions", "v0.1.0"))).toBe(true);
    });

    it("names the binary motte.exe on windows", () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "motte-install-")));
        const path = installBinary(root, "0.2.0", new Uint8Array([1]), true);

        expect(path.endsWith("motte.exe")).toBe(true);
    });
});

/**
 * These use `node:http` and `node:zlib` rather than `Bun.serve` and `Bun.gzipSync` for the same reason
 * the module under test does: vitest runs on Node, so the Bun globals are simply not defined here.
 */
describe("fetchVerifiedBinary", () => {
    let server: Server | undefined;
    let saved: string | undefined;

    beforeEach(() => {
        saved = process.env.MOTTE_DOWNLOAD_BASE;
    });

    afterEach(async () => {
        if (server !== undefined) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        if (saved === undefined) delete process.env.MOTTE_DOWNLOAD_BASE;
        else process.env.MOTTE_DOWNLOAD_BASE = saved;
    });

    /** Serve an asset and a checksums.txt, optionally with a wrong digest or a wrong asset name. */
    async function serve(
        payload: Uint8Array,
        options: { digest?: string; omitAsset?: boolean; listAs?: string } = {}
    ) {
        const target = hostTarget("linux", "x64");
        const gz = gzipSync(payload);
        const digest = options.digest ?? createHash("sha256").update(gz).digest("hex");

        server = createServer((request, response) => {
            const name = (request.url ?? "/").slice(1);

            if (name === "checksums.txt") {
                response.end(`${digest}  ${options.listAs ?? target.assetName}\n`);
                return;
            }
            if (name === target.assetName && options.omitAsset !== true) {
                response.end(gz);
                return;
            }
            response.statusCode = 404;
            response.end("not found");
        });

        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const address = server.address() as AddressInfo;
        process.env.MOTTE_DOWNLOAD_BASE = `http://127.0.0.1:${address.port}`;

        return target;
    }

    it("returns the decompressed binary when the checksum matches", async () => {
        const target = await serve(new TextEncoder().encode("a fake binary"));

        const result = await fetchVerifiedBinary("v0.1.0", target);
        expect(new TextDecoder().decode(result)).toBe("a fake binary");
    });

    it("refuses a payload whose checksum does not match", async () => {
        const target = await serve(new TextEncoder().encode("tampered"), {
            digest: "0".repeat(64)
        });

        await expect(fetchVerifiedBinary("v0.1.0", target)).rejects.toThrow(/checksum mismatch/);
    });

    it("reports a missing asset rather than installing nothing quietly", async () => {
        const target = await serve(new Uint8Array([1]), { omitAsset: true });

        await expect(fetchVerifiedBinary("v0.1.0", target)).rejects.toThrow(DownloadError);
    });

    it("refuses when this platform's asset is absent from checksums.txt", async () => {
        const target = await serve(new Uint8Array([1]), { listAs: "motte-other-platform.gz" });

        await expect(fetchVerifiedBinary("v0.1.0", target)).rejects.toThrow(
            /not listed in checksums.txt/
        );
    });
});
