import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

/**
 * How the server finds the SPA's files.
 *
 * An interface rather than a concrete reader so the embedding step (#0035) can supply the built assets
 * from inside the compiled binary without the router changing. Two implementations live here: one reading
 * a directory during development, and a placeholder for the case where the SPA has not been built.
 */
export interface Asset {
    body: Buffer | string;
    type: string;
    /** Whether the response may be cached. Hashed filenames may; index.html may not. */
    immutable: boolean;
}

export type AssetLookup = (pathname: string) => Asset | undefined;

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8"
};

function contentType(pathname: string): string {
    return TYPES[extname(pathname).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serve files from a directory.
 *
 * Used when running from source, before the assets are embedded. Paths are resolved and then checked to be
 * inside the root: without that, `GET /../../etc/passwd` would be served, and a localhost server is still
 * reachable by anything running on the machine.
 */
export function directoryAssets(root: string): AssetLookup {
    const base = resolve(root);

    return (pathname) => {
        const relative = normalize(pathname).replace(/^[/\\]+/, "");
        const candidate = resolve(join(base, relative));

        if (candidate !== base && !candidate.startsWith(base + sep)) return undefined;
        if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;

        return {
            body: readFileSync(candidate),
            type: contentType(candidate),
            // Vite's build puts a hash in the filename of everything but the entry document, as
            // `name-HASH.ext`. The hash is base64url, not hex — an earlier hex-only pattern here never
            // matched a real build, so every asset was served no-store.
            immutable: /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(candidate)
        };
    };
}

/**
 * What to serve when the SPA has not been built.
 *
 * A page saying so, rather than a 404 that reads like a broken install. The API is fully usable in this
 * state, which is worth telling whoever hit this.
 */
export function placeholderAssets(): AssetLookup {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>motte</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
    margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 2rem;
  }
  main { max-width: 34rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 1rem; opacity: 0.8; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
<main>
<h1>motte is serving, but the interface has not been built yet</h1>
<p>
  The JSON API below is live and complete. The single-page app that consumes it is still being
  built — see issues #0032 and #0034.
</p>
<ul>
  <li><code>GET /api/status</code></li>
  <li><code>GET /api/issues</code></li>
  <li><code>GET /api/issues/:id</code></li>
  <li><code>GET /api/tree</code></li>
  <li><code>GET /api/config</code></li>
  <li><code>GET /api/events</code> — server-sent events, pushed when the backlog changes</li>
</ul>
</main>
</body>
</html>
`;

    return (pathname) =>
        pathname === "/" || pathname === "/index.html"
            ? { body: html, type: TYPES[".html"]!, immutable: false }
            : undefined;
}
