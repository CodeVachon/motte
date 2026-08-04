import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedSchemas, SCHEMA_BASE } from "./json.js";
import { ConfigSchema } from "./config.js";
import { FrontmatterSchema } from "./issue.js";

/**
 * The published schemas.
 *
 * Two things are checked here. That the committed files under `schema/` match a fresh projection, so a change
 * to a zod schema without running `bun run schemas` fails rather than shipping a schema that describes the
 * previous version. And that the projection agrees with the validator about which fields are required — an
 * editor showing green on a file motte would reject is worse than publishing no schema at all.
 */

const ROOT = new URL("../../../..", import.meta.url).pathname;

function committed(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(ROOT, "schema", file), "utf8")) as Record<string, unknown>;
}

describe("the committed schemas", () => {
    it("match what the generator would write right now", () => {
        for (const { file, schema } of publishedSchemas()) {
            expect(committed(file), `schema/${file} is stale — run \`bun run schemas\``).toEqual(
                schema
            );
        }
    });

    it("are served at the URLs the config files reference", () => {
        // `motte init` writes `$schema` pointing at these, so the $id has to be the same string.
        for (const { file, schema } of publishedSchemas()) {
            expect(schema.$id).toBe(`${SCHEMA_BASE}/${file}`);
        }
    });

    /** Formatting is Prettier's business, and `bun run format:check` in the gate already covers it. */
    it("are valid JSON on disk", () => {
        for (const { file } of publishedSchemas()) {
            expect(() => committed(file)).not.toThrow();
        }
    });
});

describe("the config schema", () => {
    const schema = publishedSchemas()[0]!.schema as {
        properties: Record<string, unknown>;
        required?: string[];
    };

    /**
     * Every field is optional, which is the point: `motte init` writes a config with a handful of keys, and a
     * bare `{}` is valid. A schema demanding fields the loader defaults would flag working configs as broken.
     */
    it("requires nothing, because the loader defaults everything", () => {
        expect(schema.required ?? []).toEqual([]);
        expect(ConfigSchema.safeParse({}).success).toBe(true);
    });

    it("describes every field the loader accepts", () => {
        // Sourced from the validator rather than typed out, so adding a config field fails here until the
        // schema is regenerated.
        for (const key of Object.keys(ConfigSchema.shape)) {
            expect(Object.keys(schema.properties)).toContain(key);
        }
    });

    it("keeps the $schema field itself, so a config that references it still validates", () => {
        expect(schema.properties).toHaveProperty("$schema");
    });
});

describe("the issue schema", () => {
    const schema = publishedSchemas()[1]!.schema as {
        properties: Record<string, unknown>;
        required?: string[];
    };

    it("requires exactly what the validator requires", () => {
        // Derived from zod: a field becoming optional, or newly required, shows up here rather than in a
        // support question about an editor disagreeing with the tool.
        const required = Object.entries(FrontmatterSchema.shape)
            .filter(([, field]) => !field.safeParse(undefined).success)
            .map(([key]) => key)
            .sort();

        expect((schema.required ?? []).slice().sort()).toEqual(required);
    });

    it("describes every frontmatter field", () => {
        for (const key of Object.keys(FrontmatterSchema.shape)) {
            expect(Object.keys(schema.properties)).toContain(key);
        }
    });

    /** It is the frontmatter schema, not a whole-file schema, and the description has to say so. */
    it("says it covers the frontmatter only", () => {
        const described = publishedSchemas()[1]!.schema.description as string;

        expect(described).toMatch(/frontmatter only/);
        expect(described).toMatch(/preserved verbatim/);
    });
});
