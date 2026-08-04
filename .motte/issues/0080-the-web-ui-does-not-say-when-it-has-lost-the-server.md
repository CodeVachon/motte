---
id: 80
title: The web UI does not say when it has lost the server
state: Done
parent: 6
labels: [web, bug]
created: 2026-08-04T17:44:12Z
updated: 2026-08-04T21:19:09Z
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

## Notes

### 2026-08-04T21:19:09Z — claude (agent)

subscribe() now reports connection state and the shell shows a quiet notice while the stream is down, keeping the data on screen — it is not wrong, it has only stopped being updated. Recovery re-reads rather than just clearing the notice, because changes made during the outage produced events nobody received and no further event is coming to fix that. Verified in a real browser rather than only in jsdom: with a tab open I stopped motte serve, saw the notice appear, added an issue and moved another to Done from the CLI, restarted, and the notice cleared while the summary went from 0% / 0 of 2 to 33% / 1 of 3 with no reload. One extra case the manual pass exposed: a response EventSource treats as fatal (the 403 from the Host check) closes the stream for good, so a fresh one is opened on a slow timer — otherwise nothing ever recovers. The browser's own backoff is left alone.
