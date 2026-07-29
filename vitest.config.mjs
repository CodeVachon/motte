import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    cacheDir: ".vitest",
    resolve: {
        alias: {
            "@motte/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url))
        }
    },
    test: {
        globals: true,
        include: ["packages/*/src/**/*.test.ts"]
    }
});
