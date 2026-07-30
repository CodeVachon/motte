/**
 * Build every release asset: one self-contained binary per platform, gzipped, plus checksums.
 *
 * Bun cross-compiles all targets from one machine, so this runs on a single CI runner rather than a
 * matrix. Written in TypeScript rather than shell so the workflow stays thin and this stays readable.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Target {
    /** Bun's `--target` value. */
    bun: string;
    /** The name used in the release asset, and by install.sh when it detects the host. */
    asset: string;
    windows?: boolean;
}

const TARGETS: Target[] = [
    { bun: "bun-darwin-arm64", asset: "motte-darwin-arm64" },
    { bun: "bun-darwin-x64", asset: "motte-darwin-x64" },
    { bun: "bun-linux-x64", asset: "motte-linux-x64" },
    { bun: "bun-linux-arm64", asset: "motte-linux-arm64" },
    { bun: "bun-windows-x64", asset: "motte-windows-x64.exe", windows: true }
];

const OUT = "dist/release";
const ENTRY = "packages/cli/src/index.ts";

function megabytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const checksums: string[] = [];

for (const target of TARGETS) {
    // Bun appends .exe for windows targets on its own, so hand it the name without the suffix.
    const outfile = join(OUT, target.windows ? target.asset.replace(/\.exe$/, "") : target.asset);

    const build = Bun.spawnSync([
        "bun",
        "build",
        "--compile",
        `--target=${target.bun}`,
        `--outfile=${outfile}`,
        ENTRY
    ]);

    if (build.exitCode !== 0) {
        process.stderr.write(`failed to build ${target.asset}\n${build.stderr.toString()}\n`);
        process.exit(1);
    }

    const binary = join(OUT, target.asset);
    const raw = readFileSync(binary);

    // Gzipped assets are roughly 37% of the raw size. At five targets that is the difference between
    // a ~450MB release and a ~165MB one, for two extra lines in the installer.
    const gz = Bun.gzipSync(raw, { level: 9 });
    const archive = `${binary}.gz`;
    writeFileSync(archive, gz);
    rmSync(binary);

    // Checksum the asset that actually gets downloaded, so verification happens before decompression.
    // gzip carries its own CRC, so a corrupt decompression is caught separately by gunzip.
    const digest = new Bun.CryptoHasher("sha256").update(gz).digest("hex");
    checksums.push(`${digest}  ${target.asset}.gz`);

    process.stdout.write(
        `${target.asset.padEnd(26)} ${megabytes(raw.length).padStart(6)} -> ` +
            `${megabytes(statSync(archive).size).padStart(5)} gz\n`
    );
}

writeFileSync(join(OUT, "checksums.txt"), `${checksums.join("\n")}\n`);
process.stdout.write(`\n${checksums.length} assets plus checksums.txt in ${OUT}/\n`);
