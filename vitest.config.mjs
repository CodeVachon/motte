import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    cacheDir: ".vitest",
    resolve: {
        alias: {
            "@motte/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
            // The web app imports the server's response types. Type-only, so nothing of the CLI reaches a
            // browser bundle, but the alias has to resolve for the transform either way.
            "@motte/cli": fileURLToPath(new URL("./packages/cli/src", import.meta.url))
        }
    },
    test: {
        globals: true,
        include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
        /**
         * The CLI tests spawn a real subprocess per assertion, which is the point — wiring and exit
         * codes are what break — but it makes them an order of magnitude slower than the unit tests.
         */
        testTimeout: 30_000,
        coverage: {
            /**
             * Scoped to product source on purpose.
             *
             * Vitest's default include sweeps in `scripts/` and anything else in the repo, so a
             * headline coverage number would move whenever an untested build script is added — for
             * reasons that have nothing to do with test quality.
             */
            include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
            exclude: ["**/*.test.ts", "**/generated/**", "**/testing/**"]
        }
    }
});
