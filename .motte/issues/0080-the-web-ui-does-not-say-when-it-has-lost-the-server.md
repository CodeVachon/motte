---
id: 80
title: The web UI does not say when it has lost the server
state: Todo
parent: 6
labels: [web, bug]
created: 2026-08-04T17:44:12Z
updated: 2026-08-04T17:44:12Z
---

## Description

Stop `motte serve` with a tab open and the page keeps showing whatever it last loaded, with nothing to say the data is now stale. EventSource reconnects on its own — which is why SSE was chosen — but it does so silently and indefinitely.

Found while verifying #0035: a tab left open on a server I had stopped had logged 198 failed reconnects to /api/events, and the page still looked perfectly current.

For a tool whose whole purpose is showing where the work stands, silently showing a stale board is the wrong failure. A reader cannot tell the difference between 'nothing has changed' and 'I stopped listening an hour ago'.

## Plan

1. subscribe() reports connection state, not just changes — EventSource fires onerror on each failed attempt and onopen when it recovers
2. A quiet banner while disconnected, and clear it on reconnect
3. Do not fight the browser's own backoff; just say what is happening
4. Consider whether a reconnect should trigger a reload, since changes made while disconnected were missed
