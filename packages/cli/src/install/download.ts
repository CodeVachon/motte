import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { downloadBase, normalizeVersion, type HostTarget } from "./layout.js";

/**
 * Hashing and decompression come from `node:crypto` and `node:zlib` rather than `Bun.CryptoHasher`
 * and `Bun.gunzipSync`. Both work identically under Bun, and vitest runs on Node — so using the Bun
 * globals here would make this module impossible to test.
 */
export class DownloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DownloadError";
    }
}

async function get(url: string): Promise<Uint8Array<ArrayBuffer>> {
    let response: Response;
    try {
        response = await fetch(url, { headers: { "User-Agent": "motte" } });
    } catch (error) {
        throw new DownloadError(
            `could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (!response.ok)
        throw new DownloadError(`could not download ${url} (HTTP ${response.status})`);

    const buffer: ArrayBuffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

/**
 * Fetch a release asset and verify it against the release's own checksums.txt.
 *
 * The checksum covers the compressed asset, which is what actually crossed the network — gzip's own
 * CRC catches a corrupt decompression separately. Verification happens before anything is written to
 * the install directory.
 */
export async function fetchVerifiedBinary(
    version: string,
    target: HostTarget
): Promise<Uint8Array> {
    const base = downloadBase(version);

    const [archive, checksums] = await Promise.all([
        get(`${base}/${target.assetName}`),
        get(`${base}/checksums.txt`).then((bytes) => new TextDecoder().decode(bytes))
    ]);

    const line = checksums
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => entry.endsWith(` ${target.assetName}`));

    if (line === undefined) {
        throw new DownloadError(
            `${target.assetName} is not listed in checksums.txt for ${version}`
        );
    }

    const expected = line.split(/\s+/)[0]!;
    const actual = createHash("sha256").update(archive).digest("hex");

    if (expected !== actual) {
        throw new DownloadError(
            `checksum mismatch for ${target.assetName}\n  expected ${expected}\n  actual   ${actual}`
        );
    }

    try {
        return new Uint8Array(gunzipSync(archive));
    } catch (error) {
        throw new DownloadError(
            `could not decompress ${target.assetName}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Write a verified binary into its version directory and repoint `current`.
 *
 * `~/.local/bin/motte` already points at `current`, so repointing `current` is what makes a new
 * version take effect — and what makes rollback a symlink change rather than a reinstall.
 */
export function installBinary(
    root: string,
    version: string,
    binary: Uint8Array,
    windows: boolean
): string {
    const normalized = normalizeVersion(version);
    const versionDir = join(root, "versions", normalized);
    const binDir = join(versionDir, "bin");
    const path = join(binDir, windows ? "motte.exe" : "motte");

    mkdirSync(binDir, { recursive: true });
    writeFileSync(path, binary);
    if (!windows) chmodSync(path, 0o755);

    const current = join(root, "current");
    // symlinkSync will not overwrite, so the old link has to go first.
    if (existsSync(current)) rmSync(current, { recursive: true, force: true });
    symlinkSync(versionDir, current, "dir");

    return path;
}

export interface PruneResult {
    removed: string[];
    /**
     * A version that was eligible but kept because it is the running binary. Reported rather than
     * skipped silently, so `--keep 1` leaving two versions behind is explained instead of looking
     * like the flag was ignored.
     */
    keptRunning?: string;
}

/**
 * Remove all but the newest `keep` versions, never the one currently executing.
 *
 * These binaries carry the whole Bun runtime — 58MB on darwin-arm64, 110MB on Windows — so keeping
 * every version would grow the install directory fast. codegraph keeps them all; motte does not.
 *
 * The running version is never removed. Deleting a running executable is harmless on Unix, where the
 * inode survives until the process exits, but fails outright on Windows where the file is locked. It
 * gets cleaned up by the next upgrade, when it is no longer the one running.
 */
export function pruneVersions(
    versionsDir: string,
    ordered: string[],
    keep: number,
    active: string
): PruneResult {
    const removed: string[] = [];
    let keptRunning: string | undefined;

    for (const version of ordered.slice(Math.max(keep, 1))) {
        if (version === active) {
            keptRunning = version;
            continue;
        }
        rmSync(join(versionsDir, version), { recursive: true, force: true });
        removed.push(version);
    }

    return keptRunning === undefined ? { removed } : { removed, keptRunning };
}
