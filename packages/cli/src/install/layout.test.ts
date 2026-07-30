import { describe, expect, it } from "vitest";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    symlinkSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    compareVersionsDescending,
    hostTarget,
    installedVersions,
    locateInstall,
    normalizeVersion,
    UnsupportedHostError
} from "./layout.js";

describe("hostTarget", () => {
    it("names the asset the release workflow publishes", () => {
        expect(hostTarget("darwin", "arm64").assetName).toBe("motte-darwin-arm64.gz");
        expect(hostTarget("linux", "x64").assetName).toBe("motte-linux-x64.gz");
    });

    it("adds .exe on windows", () => {
        expect(hostTarget("win32", "x64").assetName).toBe("motte-windows-x64.exe.gz");
    });

    it("rejects a platform with no build", () => {
        expect(() => hostTarget("freebsd", "x64")).toThrow(UnsupportedHostError);
        // linux-arm64 is built, windows-arm64 is not.
        expect(() => hostTarget("win32", "arm64")).toThrow(/no build is published/);
        expect(() => hostTarget("linux", "arm64")).not.toThrow();
    });

    it("rejects an architecture with no build", () => {
        expect(() => hostTarget("linux", "s390x")).toThrow(UnsupportedHostError);
    });
});

/**
 * The reason `upgrade` may safely reimplement what install.sh does.
 *
 * These read the shell script and assert it still agrees with the TypeScript on the two things both
 * depend on: how release assets are named, and where an installation lives. If either side changes
 * without the other, this fails — which is the whole point, since a silent divergence would mean
 * `curl | sh` and `motte upgrade` installing to different places or fetching different files.
 */
describe("install.sh agrees with this module", () => {
    const script = readFileSync(
        join(import.meta.dirname, "..", "..", "..", "..", "install.sh"),
        "utf8"
    );

    it("builds the same asset name", () => {
        // install.sh: printf 'motte-%s-%s' "$os_name" "$arch_name"  then  asset="$target.gz"
        expect(script).toContain("printf 'motte-%s-%s'");
        expect(script).toContain('asset="$target.gz"');

        const { assetName } = hostTarget("linux", "x64");
        expect(assetName).toBe("motte-linux-x64.gz");
    });

    it("uses the same directory layout", () => {
        expect(script).toContain('version_dir="$INSTALL_DIR/versions/$version"');
        expect(script).toContain('"$version_dir/bin/motte"');
        expect(script).toContain('ln -sfn "$version_dir" "$INSTALL_DIR/current"');
    });

    it("supports exactly the platforms this module supports", () => {
        // install.sh whitelists the built combinations in one case statement.
        expect(script).toContain("darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64");

        for (const [platform, arch] of [
            ["darwin", "arm64"],
            ["darwin", "x64"],
            ["linux", "x64"],
            ["linux", "arm64"]
        ] as [NodeJS.Platform, string][]) {
            expect(() => hostTarget(platform, arch)).not.toThrow();
        }
    });

    it("honours the same environment overrides", () => {
        for (const name of [
            "MOTTE_VERSION",
            "MOTTE_INSTALL_DIR",
            "MOTTE_BIN_DIR",
            "MOTTE_DOWNLOAD_BASE"
        ]) {
            expect(script).toContain(name);
        }
    });

    it("verifies a checksum before installing", () => {
        expect(script).toContain("checksums.txt");
        expect(script.indexOf("verify ")).toBeLessThan(
            script.indexOf('mkdir -p "$version_dir/bin"')
        );
    });
});

describe("locateInstall", () => {
    function fakeInstall(version = "v0.1.0"): { root: string; binary: string } {
        // realpath the root: on macOS /var is a symlink to /private/var, and locateInstall resolves
        // symlinks by design, so an unresolved fixture path would never match what it returns.
        const root = realpathSync(mkdtempSync(join(tmpdir(), "motte-install-")));
        const binDir = join(root, "versions", version, "bin");
        mkdirSync(binDir, { recursive: true });
        const binary = join(binDir, "motte");
        writeFileSync(binary, "#!/bin/sh\n");
        return { root, binary };
    }

    it("finds the root three levels above the binary", () => {
        const { root, binary } = fakeInstall();
        const install = locateInstall(binary);

        expect(install).toBeDefined();
        expect(install!.version).toBe("v0.1.0");
        expect(install!.versionsDir).toBe(join(root, "versions"));
        expect(install!.currentLink).toBe(join(root, "current"));
    });

    it("resolves through the current symlink and a bin symlink", () => {
        const { root, binary } = fakeInstall();
        const current = join(root, "current");
        symlinkSync(join(root, "versions", "v0.1.0"), current, "dir");

        const binDir = mkdtempSync(join(tmpdir(), "motte-bin-"));
        const link = join(binDir, "motte");
        symlinkSync(join(current, "bin", "motte"), link);

        // This is what makes upgrade possible: invoking through ~/.local/bin still identifies the
        // real version directory.
        expect(locateInstall(link)?.version).toBe("v0.1.0");
        expect(locateInstall(link)?.root).toBe(root);
        expect(binary).toContain("v0.1.0");
    });

    it("returns undefined for a binary outside a versions layout", () => {
        const dir = mkdtempSync(join(tmpdir(), "motte-loose-"));
        const loose = join(dir, "motte");
        writeFileSync(loose, "#!/bin/sh\n");

        expect(locateInstall(loose)).toBeUndefined();
    });

    it("returns undefined when the parent directory is not named bin", () => {
        const root = mkdtempSync(join(tmpdir(), "motte-odd-"));
        const dir = join(root, "versions", "v0.1.0", "sbin");
        mkdirSync(dir, { recursive: true });
        const binary = join(dir, "motte");
        writeFileSync(binary, "");

        expect(locateInstall(binary)).toBeUndefined();
    });

    it("returns undefined for a path that does not exist", () => {
        expect(
            locateInstall(join(tmpdir(), "motte-nope", "versions", "v1", "bin", "motte"))
        ).toBeUndefined();
    });
});

describe("installedVersions", () => {
    it("lists versions newest first and ignores anything that is not one", () => {
        const versions = mkdtempSync(join(tmpdir(), "motte-versions-"));
        for (const name of ["v0.1.0", "v0.10.0", "v0.2.0", "v1.0.0", "notes.txt", "tmp"]) {
            mkdirSync(join(versions, name), { recursive: true });
        }

        expect(installedVersions(versions)).toEqual(["v1.0.0", "v0.10.0", "v0.2.0", "v0.1.0"]);
    });

    it("returns nothing for a directory that does not exist", () => {
        expect(installedVersions(join(tmpdir(), "motte-absent"))).toEqual([]);
    });
});

describe("compareVersionsDescending", () => {
    it("orders by major, minor, then patch", () => {
        expect(["v0.2.0", "v1.0.0", "v0.10.0"].sort(compareVersionsDescending)).toEqual([
            "v1.0.0",
            "v0.10.0",
            "v0.2.0"
        ]);
    });

    it("treats equal versions as equal", () => {
        expect(compareVersionsDescending("v1.2.3", "v1.2.3")).toBe(0);
    });

    it("ranks a release above its own prerelease", () => {
        expect(["v1.0.0-rc.1", "v1.0.0"].sort(compareVersionsDescending)).toEqual([
            "v1.0.0",
            "v1.0.0-rc.1"
        ]);
    });
});

describe("normalizeVersion", () => {
    it("adds a leading v", () => {
        expect(normalizeVersion("0.1.0")).toBe("v0.1.0");
        expect(normalizeVersion("v0.1.0")).toBe("v0.1.0");
        expect(normalizeVersion("  0.1.0  ")).toBe("v0.1.0");
    });
});
