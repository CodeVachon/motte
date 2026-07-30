import type { ServerResponse } from "node:http";

/**
 * Server-sent events, one stream per open browser tab.
 *
 * SSE rather than a WebSocket because the traffic is one-directional — the server says "something
 * changed", the browser re-fetches — and SSE reconnects on its own, which for a tool the user leaves open
 * while an agent works in the background is the property that matters.
 */
export interface Broadcaster {
    /** Attach a response as a subscriber. Returns a function that detaches it. */
    subscribe(response: ServerResponse): () => void;
    /** Send an event to every subscriber. */
    send(event: string, data: unknown): void;
    /** Number of attached subscribers. */
    readonly size: number;
    /** Detach everyone and stop the keep-alive. */
    close(): void;
}

export interface BroadcasterOptions {
    /**
     * How often to write a comment line, in milliseconds.
     *
     * Proxies and some browsers drop a connection that has been silent for long enough, and the tab then
     * shows stale data until something else happens to change. A comment is the cheapest possible traffic:
     * the client ignores it, but the socket stays alive.
     */
    keepAliveMs?: number;
}

export function createBroadcaster(options: BroadcasterOptions = {}): Broadcaster {
    const subscribers = new Set<ServerResponse>();
    const keepAliveMs = options.keepAliveMs ?? 25_000;

    const timer = setInterval(() => {
        for (const response of subscribers) response.write(": keep-alive\n\n");
    }, keepAliveMs);
    // Never hold the process open for a heartbeat.
    timer.unref?.();

    return {
        get size() {
            return subscribers.size;
        },

        subscribe(response) {
            subscribers.add(response);

            const detach = (): void => {
                subscribers.delete(response);
            };

            // The browser closing a tab is the normal way a stream ends, so it must not be an error.
            response.on("close", detach);
            return detach;
        },

        send(event, data) {
            // Framed per the SSE spec: an event name line, one data line, then a blank line to dispatch.
            const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

            for (const response of subscribers) {
                // A subscriber that has gone away between the close event and now must not take down the
                // broadcast to everyone else.
                try {
                    response.write(frame);
                } catch {
                    subscribers.delete(response);
                }
            }
        },

        close() {
            clearInterval(timer);
            for (const response of subscribers) response.end();
            subscribers.clear();
        }
    };
}
