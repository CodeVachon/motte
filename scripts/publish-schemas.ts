/**
 * Copy the published JSON Schemas into the built site.
 *
 *   bun run build:site
 *
 * They are served from the same deployment as the landing page because that is where every
 * `.motte.config.json` says they are: `motte init` writes a `$schema` field pointing at
 * `codevachon.github.io/motte/schema/config.json`, and until this ran, that URL 404ed.
 *
 * The committed files under `schema/` are copied rather than regenerated here, so what is published is
 * exactly what is in the repository — `packages/core/src/schema/json.test.ts` is what guarantees those
 * files still match the zod schemas they were projected from.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { publishedSchemas } from "@motte/core";
import astroConfig from "../apps/site/astro.config.js";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = join(ROOT, "schema");
const OUT = join(ROOT, "apps/site/dist/schema");

/**
 * Where this deployment will serve the schemas, taken from the site config rather than restated.
 *
 * `$id` and the deployment URL have to be the same string. If they ever disagree, editors go quiet and
 * nothing else notices — so a mismatch fails the build here instead.
 */
const site = `${String(astroConfig.site).replace(/\/$/, "")}${astroConfig.base ?? ""}`;

mkdirSync(OUT, { recursive: true });

for (const { file } of publishedSchemas()) {
    const from = join(SOURCE, file);
    const expected = `${site}/schema/${file}`;
    const id = (JSON.parse(readFileSync(from, "utf8")) as { $id?: string }).$id;

    if (id !== expected) {
        console.error(
            `schema/${file} claims to live at ${id}, but this site publishes it at ${expected}.\n` +
                "Update SCHEMA_BASE in packages/core/src/schema/json.ts (and run `bun run schemas`), or " +
                "the site config in apps/site/astro.config.mjs, so the two agree."
        );
        process.exit(1);
    }

    copyFileSync(from, join(OUT, file));
    console.log(`✓ published ${relative(ROOT, join(OUT, file))} at ${expected}`);
}
