import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The on-disk contract shared with `install.sh` and `install.ps1`.
 *
 * ```
 * <root>/versions/v<X.Y.Z>/bin/motte   the binary
 * <root>/current -> versions/v<X.Y.Z>  the active version
 * <bin>/motte -> <root>/current/bin/motte
 * ```
 *
 * `upgrade` reimplements the download rather than shelling out to the installer, so that one code
 * path covers every platform including Windows, where there is no `sh`. The cost is two
 * implementations of the same layout — so `layout.test.ts` reads install.sh and asserts the asset
 * naming and directory shape here still match it. That check is the reason this duplication is safe.
 */
export const REPO = "CodeVachon/motte";

export type Platform = "darwin" | "linux" | "windows";
export type Arch = "x64" | "arm64";

export interface HostTarget {
    platform: Platform;
    arch: Arch;
    /** Release asset name, without the `.gz`. */
    binaryName: string;
    /** Release asset name as published. */
    assetName: string;
}

export class UnsupportedHostError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsupportedHostError";
    }
}

/** The five combinations the release workflow builds. */
const BUILT_TARGETS = new Set([
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "windows-x64"
]);

export function hostTarget(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
): HostTarget {
    const os: Platform | undefined =
        platform === "darwin"
            ? "darwin"
            : platform === "linux"
              ? "linux"
              : platform === "win32"
                ? "windows"
                : undefined;

    if (os === undefined) throw new UnsupportedHostError(`unsupported platform: ${platform}`);

    const cpu: Arch | undefined = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
    if (cpu === undefined) throw new UnsupportedHostError(`unsupported architecture: ${arch}`);

    if (!BUILT_TARGETS.has(`${os}-${cpu}`)) {
        throw new UnsupportedHostError(`no build is published for ${os}-${cpu}`);
    }

    const binaryName = `motte-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
    return { platform: os, arch: cpu, binaryName, assetName: `${binaryName}.gz` };
}

export interface BundleInstall {
    /** `~/.motte` by default. */
    root: string;
    /** The version directory the running binary lives in, e.g. `v0.1.0`. */
    version: string;
    /** Absolute path to the running binary. */
    binary: string;
    versionsDir: string;
    currentLink: string;
}

/**
 * Locate the installation the running binary belongs to, or undefined when it is not one.
 *
 * `process.execPath` fully resolves symlinks, so invoking motte through `~/.local/bin/motte` — itself
 * a link to `current`, which is a link to a version directory — still reports the real path. Running
 * from source reports the Bun executable instead, which is how a dev run is detected.
 */
export function locateInstall(execPath: string = process.execPath): BundleInstall | undefined {
    let binary: string;
    try {
        binary = realpathSync(execPath);
    } catch {
        return undefined;
    }

    const binDir = dirname(binary);
    if (basename(binDir) !== "bin") return undefined;

    const versionDir = dirname(binDir);
    const versionsDir = dirname(versionDir);
    if (basename(versionsDir) !== "versions") return undefined;

    const root = dirname(versionsDir);

    return {
        root,
        version: basename(versionDir),
        binary,
        versionsDir,
        currentLink: join(root, "current")
    };
}

/** Installed versions, newest first by semantic ordering. */
export function installedVersions(versionsDir: string): string[] {
    if (!existsSync(versionsDir)) return [];

    return readdirSync(versionsDir)
        .filter((name) => /^v\d+\.\d+\.\d+/.test(name))
        .sort(compareVersionsDescending);
}

/** Descending semantic comparison. Prerelease suffixes sort before the plain version. */
export function compareVersionsDescending(a: string, b: string): number {
    const parse = (raw: string) => {
        const match = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(raw);
        if (!match) return { parts: [0, 0, 0], pre: "" };
        return {
            parts: [Number(match[1]), Number(match[2]), Number(match[3])],
            pre: match[4] ?? ""
        };
    };

    const left = parse(a);
    const right = parse(b);

    for (let i = 0; i < 3; i += 1) {
        const diff = right.parts[i]! - left.parts[i]!;
        if (diff !== 0) return diff;
    }

    // 1.0.0 outranks 1.0.0-rc.1; two prereleases fall back to lexical order.
    if (left.pre === right.pre) return 0;
    if (left.pre === "") return -1;
    if (right.pre === "") return 1;
    return right.pre.localeCompare(left.pre);
}

/** Normalise `0.1.0` and `v0.1.0` to `v0.1.0`. */
export function normalizeVersion(version: string): string {
    const trimmed = version.trim();
    return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function downloadBase(version: string): string {
    return (
        process.env.MOTTE_DOWNLOAD_BASE ??
        `https://github.com/${REPO}/releases/download/${normalizeVersion(version)}`
    );
}
