import { defineConfig } from "astro/config";

/**
 * The landing page, deployed to GitHub Pages by `.github/workflows/pages.yml`.
 *
 * `base` is the repository name because this is a project page rather than a user page: everything is
 * served under `/motte/`, which is also why the published JSON Schemas live at
 * `codevachon.github.io/motte/schema/*.json` — the URL every `.motte.config.json` already carries in its
 * `$schema` field. Changing either of these means changing that field, so they are not cosmetic.
 */
export default defineConfig({
    site: "https://codevachon.github.io",
    base: "/motte",
    // A static build with no server: Pages serves files, and the site has nothing dynamic in it.
    output: "static",
    devToolbar: { enabled: false }
});
