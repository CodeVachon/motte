---
id: 33
title: Serve API and SSE watcher
state: In Progress
parent: 6
labels: [web]
created: 2026-07-29T11:55:00Z
updated: 2026-07-30T20:04:40Z
---

## Description

`Bun.serve()` bound to `127.0.0.1` with no auth, exposing the embedded SPA and a JSON API over
core. An SSE endpoint driven by the file watcher pushes changes, so the browser updates when an
agent writes to disk.

## Plan

1. File watcher in core (watch.ts), debounced, emitting change events
2. Router over node:http — NOT Bun.serve, see the note — bound to 127.0.0.1
3. GET/POST /api/issues, GET/PATCH /api/issues/:id, POST /api/issues/:id/notes, GET /api/config, GET /api/status
4. GET /api/events as SSE, fed by the watcher
5. Static handler behind an asset-lookup interface, so #0035 fills it in without touching the router
6. --port and --open

## Notes

### 2026-07-30T19:46:09Z — claude (agent)

Changed this from Bun.serve to node:http, and retitled it, before starting.

The founding plan chose Bun.serve on the reasoning that distribution is Bun-compiled binaries only, so Bun
APIs cost nothing. That reasoning was about the build, and it missed the test story: vitest runs on Node, so
every Bun.* global is undefined under test. This project has already paid that twice — download.ts had to be
rewritten off Bun.gzipSync and Bun.serve to node:zlib and node:http before it could be tested at all, and
AGENTS.md now says to prefer the node: equivalents in library code for exactly this reason.

The server is the wrong place to make that mistake a third time. Routing, request parsing, validation, error
shapes and SSE framing are the logic here, and all of it would be untestable behind Bun.serve. node:http is
implemented by Bun, works identically in the compiled binary, and lets the whole server be driven in-process
against a real socket on port 0 — which is how install/download.test.ts already tests HTTP.

What is lost: Bun.serve's routing sugar and its faster request handling. Neither matters for a localhost
single-user tool, and the router is a few lines either way.

Also splitting the watcher out as its own step. It belongs in core beside the rest of the data layer, it is
what the SSE endpoint is fed by, and it has its own awkward edges — editors writing through temp files, and
motte's own writes triggering events.

### 2026-07-30T20:04:40Z — claude (agent)

Step 1 done: the file watcher in core, with the SSE endpoint and the rest of the API still to come.

watchBacklog reports that the backlog moved, not what moved in it, debounced so one logical write is one
change. That coarseness is deliberate — every consumer's response is to re-read through IssueStore, which is
mtime-cached and so only re-parses what actually changed, and computing a real diff would mean keeping a
shadow copy of every issue.

Most of the work here went into making it testable, and that is worth writing down because I got it wrong
first.

The first version of the tests wrote real files and waited for macOS to notice. Every assertion passed when
the file ran alone, and roughly one full-suite run in three failed — differently each time. Chasing it
properly took five probes, and three of my hypotheses were wrong: I blamed sibling directories
cross-reporting, then node versus bun, then a spurious startup echo. All three were disproved by
experiment. The actual cause only became visible after instrumenting the watcher itself under vitest: with
two dozen test files running in parallel, macOS delivered directory events anywhere from immediately to not
within five seconds, and a burst of five writes was sometimes genuinely spread wider than the debounce — so
it really was five bursts, and the assertion was wrong rather than the code.

Two of my probes were also misleading because I ran them under bun while the tests run under node. Same
class of mistake as before: check the fixture, and check it in the environment that actually matters.

So the watcher now takes an injectable watchDir factory, defaulting to fs.watch. Sixteen tests deliver
directory events by hand and assert the mapping from events to changes — attribution, de-duplication,
ordering, the temp-file case, a null filename, no id carry-over, shutdown, abort. One integration test
covers the wiring to the real fs.watch, and it is the only one that can care how busy the machine is; it
retries, for the reasons #0072 taught.

The file went from 5+ seconds of sleeping to 1.2 seconds, and five consecutive full-suite runs are clean.

Also documented in watch.ts, because it cannot be engineered away: a change made just before watching
started can be delivered just after, carrying the watched directory's own name. Harmless — the response to
any change is to re-read — but callers asserting on exact sequences have to settle first.
