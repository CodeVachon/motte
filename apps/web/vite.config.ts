import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * The SPA `motte serve` hosts.
 *
 * Two ways to run it. `bun run dev` starts Vite and proxies `/api` to a `motte serve` on 4321, so the UI
 * reloads on save while talking to a real backlog. `bun run build` emits static files that `motte serve
 * --assets` can host directly, and that #0035 will embed into the binary.
 */
export default defineConfig({
    plugins: [react(), tailwind()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            // Type-only imports of the server's response shapes are erased at build time, so this alias
            // never puts CLI code in the bundle. It exists so the client cannot drift from the server.
            "@motte/cli": fileURLToPath(new URL("../../packages/cli/src", import.meta.url))
        }
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:4321",
                changeOrigin: false
            }
        }
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // Sourcemaps would double the size of what gets embedded in the binary for no benefit to a user.
        sourcemap: false
    }
});
