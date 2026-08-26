import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The landing page, checked for the things a visitor cannot recover from being wrong.
 *
 * Prose is not tested — it is prose. What is tested is the install command, because it is the first thing
 * anybody runs and a stale URL on a marketing page is indistinguishable from a broken project, and the
 * schema links, because they are the reason this site exists at all.
 *
 * Beside `src/` rather than in `src/pages/`, because Astro renders everything under `pages/` as a route and
 * tried to prerender this file as a page — which failed the build with a vitest internal-state error.
 */

const ROOT = new URL("../../..", import.meta.url).pathname;

const page = readFileSync(join(ROOT, "apps/site/src/pages/index.astro"), "utf8");
const readme = readFileSync(join(ROOT, "ReadMe.md"), "utf8");

/** The one-liners the page tells people to paste, pulled back out of the source. */
function installCommands(): string[] {
    return [...page.matchAll(/^const install\w+ =\s*\n?\s*"([^"]+)";$/gm)].map(
        (match) => match[1]!
    );
}

describe("the install commands", () => {
    it("are the two the ReadMe gives", () => {
        const commands = installCommands();

        expect(commands).toHaveLength(2);
        for (const command of commands) {
            // The ReadMe is the canonical copy; drift between the two is how somebody ends up pasting a
            // command that installs an older path or a repository that has been renamed.
            expect(readme, `the ReadMe does not contain: ${command}`).toContain(command);
        }
    });

    it("point at installers that exist in this repository", () => {
        for (const command of installCommands()) {
            const script = command.match(/main\/(install\.(?:sh|ps1))/)?.[1];

            expect(script, `no installer path in: ${command}`).toBeDefined();
            expect(existsSync(join(ROOT, script!)), `${script} is missing`).toBe(true);
        }
    });
});

describe("the schema links", () => {
    /**
     * These are the whole reason for the site: every `.motte.config.json` motte writes points `$schema` at
     * a URL under this deployment, so the page must link the files the build actually publishes.
     */
    it("name the schema files the build publishes", () => {
        for (const file of ["config.json", "issue.json"]) {
            expect(page).toContain(`/schema/${file}`);
            expect(existsSync(join(ROOT, "schema", file))).toBe(true);
        }
    });

    it("are built from the configured base, not hardcoded", () => {
        // A hardcoded `/motte/...` breaks the moment the site moves to a vanity domain, and the failure is
        // a 404 nobody notices. #0039 is that move.
        expect(page).toContain("import.meta.env.BASE_URL");
        expect(page).not.toContain('href="/motte/');
    });
});

describe("configured issue fields", () => {
    it("introduces typed custom metadata and its CLI filter", () => {
        expect(page).toContain("Make the issue format yours");
        expect(page).toContain("customer");
        expect(page).toContain("referenceUrl");
        expect(page).toContain("motte status --field customer=Sears");
    });
});
