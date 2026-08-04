import { z } from "zod";
import { ConfigSchema } from "./config.js";
import { FrontmatterSchema } from "./issue.js";

/**
 * The published JSON Schemas, projected from the zod schemas that actually validate.
 *
 * In core rather than in the emitting script because this is where zod already lives, and because keeping
 * the projection beside the definition is what stops the two describing different things. The script under
 * `scripts/` only writes what this returns.
 *
 * Generated rather than hand-written for the same reason: a hand-maintained schema can describe a config the
 * loader would reject, and an editor showing green on a file motte refuses is worse than no schema at all.
 */

/** Where the schemas are served. The `$schema` field `motte init` writes points at these. */
export const SCHEMA_BASE = "https://codevachon.github.io/motte/schema";

export interface PublishedSchema {
    /** Filename under `schema/`. */
    file: string;
    schema: Record<string, unknown>;
}

export function publishedSchemas(): PublishedSchema[] {
    return [
        {
            file: "config.json",
            schema: {
                // `io: "input"` describes what a user may write, not what the loader hands back — the
                // difference being defaults, which are optional in a file and always present after parsing.
                ...z.toJSONSchema(ConfigSchema, { io: "input" }),
                $id: `${SCHEMA_BASE}/config.json`,
                title: "motte project configuration",
                description:
                    "The .motte.config.json at the root of a motte project. Every field is optional: an " +
                    "empty object is a valid config, and motte applies the defaults described here."
            }
        },
        {
            file: "issue.json",
            schema: {
                ...z.toJSONSchema(FrontmatterSchema, { io: "input" }),
                $id: `${SCHEMA_BASE}/issue.json`,
                title: "motte issue frontmatter",
                description:
                    "The YAML frontmatter of an issue file under .motte/issues/. This covers the " +
                    "frontmatter only: the rest of the file is Markdown with Description, Plan and Notes " +
                    "sections, and any section motte does not recognise is preserved verbatim on rewrite."
            }
        }
    ];
}
