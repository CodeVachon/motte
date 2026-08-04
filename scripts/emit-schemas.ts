/**
 * Write the published JSON Schemas to `schema/`.
 *
 *   bun run schemas
 *
 * The schemas themselves are built in `packages/core/src/schema/json.ts`, beside the zod definitions they
 * are projected from. This only writes them out.
 *
 * Unlike the embedded web assets these files are committed: they are the published artefact, they are small,
 * and GitHub Pages serves them at the URLs every `.motte.config.json` already names in its `$schema` field.
 * `schema/json.test.ts` compares the committed files against a fresh projection, so changing a zod schema
 * without running this fails rather than quietly shipping a stale schema.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { format } from "prettier";
import { publishedSchemas } from "@motte/core";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "schema");

mkdirSync(OUT, { recursive: true });

for (const { file, schema } of publishedSchemas()) {
    const path = join(OUT, file);

    // Formatted with Prettier rather than JSON.stringify. The two disagree — Prettier keeps a short array on
    // one line, stringify always expands — and without this, running the generator would leave the repo
    // failing `format:check` until someone ran `bun run format`. The generator owning the final bytes means
    // there is no order the two have to be run in.
    writeFileSync(path, await format(JSON.stringify(schema), { parser: "json" }), "utf8");
    console.log(`✓ wrote ${relative(ROOT, path)}`);
}
