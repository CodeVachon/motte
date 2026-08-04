/**
 * Types for the generated asset module, committed so the import typechecks when the module is not there.
 *
 * `webAssets.ts` is written by `scripts/embed-web-assets.ts` and gitignored — it is a few hundred kilobytes
 * of base64 that would otherwise churn in every diff. TypeScript resolves `./generated/webAssets.js` to this
 * declaration when the implementation is absent, so a fresh clone typechecks without running a web build,
 * and the runtime import is guarded either way.
 */
export declare const ASSETS: Record<string, { type: string; immutable: boolean; base64: string }>;
