---
id: 32
title: Vite, React, and Tailwind SPA scaffold
state: Done
parent: 6
labels: [web]
created: 2026-07-29T11:54:00Z
updated: 2026-07-31T15:24:36Z
---

## Description

`apps/web` on Vite + React 19 + Tailwind 4 + shadcn, matching the component vocabulary already in
use in the notes2 project.

## Plan

1. apps/web on Vite + React 19 + TypeScript, with its own tsconfig since it needs jsx and DOM
2. Tailwind 4 via @tailwindcss/vite, CSS-first config, plus the cn() helper shadcn components expect
3. A typed API client whose types are imported from the server rather than generated — see the note
4. A dev proxy so the SPA talks to a running motte serve, and a build whose output motte serve can host
5. Verify it actually renders, with Playwright rather than by asserting that it compiles

## Notes

### 2026-07-31T15:14:23Z — claude (agent)

Correcting step 3 before building it. The plan said "typed API client generated from core's zod schemas",
and that would produce the wrong types.

Core's zod schemas describe what is stored — the frontmatter of an issue file. The API's responses are a
different shape: they add openBlockers and children, which are derived and never stored, rename filePath to
file, and turn absent optionals into null so JSON.stringify does not drop them. Generating a client from
FrontmatterSchema would produce something that does not match any response the server sends.

There is also no generation step needed. apps/web is in the same repository, so the client can import the
server's own response types directly as type-only imports, which Vite erases at build time. That gives the
client and the server one shared definition rather than two that agree until they do not — the failure this
project already had with blockedBy in #0069, and the reason both JSON shapes now carry a completeness guard.

On shadcn: setting up its foundation — the design tokens as CSS variables and the cn() helper its components
are written against — rather than running the CLI to pull in a component library before anything uses it.
Unused components would be dead code, which fallow would rightly flag, and #0034 can add each component as
a view actually needs it.

### 2026-07-31T15:24:36Z — claude (agent)

Done. apps/web on Vite 8, React 19.2 and Tailwind 4.3, and it renders the real backlog.

Verified in a browser rather than by asserting that it compiles, which was the plan's step 5. Built the SPA,
served it with `motte serve --assets apps/web/dist`, and drove it with Playwright: the page shows this
project's own 77 issues at 71%, the four counts match what the CLI reports, and there are no console errors
or warnings. Then, with the page still open, I moved #0068 from Todo to In Progress from the CLI — the
counts changed from 18/4 to 17/5 with no reload. That is the SSE path from #0033 working through a real
EventSource in a real browser, which is the thing the whole architecture is for.

Two real bugs found by looking rather than by testing.

Hashed assets were served no-store. My immutable-detection pattern matched a hex hash, but Vite's is
base64url with mixed case — `index-BMkVQf6L.js` — so no real build ever matched it and every asset was
uncacheable. The test that covered this used a made-up hex filename, so it passed while being wrong about
the thing it existed to check. Now it uses a genuine Vite name, and asserts index.html stays no-store.

And /api/status was returning whole Issue objects for in-progress work, because it spread projectReport,
which includes them. That put unknownSections and absolute file paths into an API response. Now ids, like
ready and blocked, with a test that the response carries neither.

That second one came out of a mistake worth recording. I set out to derive every response type from the
function that builds it, then hand-wrote StatusResponse anyway — and immediately got it wrong by omitting a
field the server was really sending. Deriving it properly is what surfaced the leak.

On the plan's "typed API client generated from core's zod schemas": nothing is generated. The client imports
the server's response types directly, as type-only imports the bundler erases. Core's schemas describe what
is stored, not what is served, so generating from them would have produced a client matching no response the
server sends.

shadcn's CLI was not run. Its foundation is here — the design tokens as CSS variables and the cn() helper
its components are written against — but pulling in a component library before any view uses it would be
dead code, and #0034 can add each piece as a view needs it.

Two housekeeping things. TypeScript: `bun add` pulled typescript 7 into apps/web alongside the root's 5.9;
removed, so the repo has one compiler. And the root typecheck now runs both projects, since apps/web has its
own tsconfig and would otherwise never be checked. CI builds the SPA too — a bundle that stopped compiling
should fail there, not at release.
