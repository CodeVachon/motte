import pkg from "../../../package.json";

/**
 * The version motte reports, taken from the root package.json rather than duplicated in source.
 *
 * Bun inlines a JSON import at compile time, so this is baked into the binary and cannot drift from
 * the version the release was cut from. The release workflow additionally refuses to build when the
 * git tag disagrees with this value.
 *
 * Kept in its own module so `upgrade` can read it without importing the CLI entry point, which
 * imports `upgrade` in turn.
 */
export const VERSION: string = pkg.version;
