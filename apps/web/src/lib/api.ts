import type {
    ConfigResponse,
    ErrorResponse,
    IssueListResponse,
    IssueResponse,
    SearchResponse,
    StatusResponse,
    TreeResponse
} from "@motte/cli/serve/api.js";

/**
 * The client for `motte serve`'s JSON API.
 *
 * Every type here is imported from the server rather than restated. Nothing is generated: `apps/web` is in
 * the same repository, and a type-only import is erased by the bundler, so the client and the server share
 * one definition instead of two that agree until they quietly stop. That mattering is not hypothetical —
 * `blockedBy` went missing from a response for several commits because two hand-maintained shapes drifted.
 *
 * Relative URLs throughout. In development Vite proxies `/api` to a running `motte serve`; in production the
 * same server hosts these files, so there is no origin to configure and nothing to get wrong per
 * environment.
 */

// Re-exported so views import their types from the client they call rather than reaching into the CLI
// package. Only the shapes a view actually names are forwarded — the list and tree responses are consumed
// through `api.issues()` and `api.tree()`, whose return types carry them.
export type {
    ConfigResponse,
    IssueResponse,
    SearchResponse,
    StatusResponse
} from "@motte/cli/serve/api.js";

/** A response the server refused. Carries the status so a caller can tell 404 from 409. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
        response = await fetch(`/api${path}`, {
            ...init,
            headers: {
                ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
                ...init?.headers
            }
        });
    } catch (thrown) {
        // The server having stopped is the common case here — a Ctrl-C in the terminal the UI was started
        // from — and "failed to fetch" alone does not suggest that.
        throw new ApiError(
            0,
            `could not reach motte serve: ${thrown instanceof Error ? thrown.message : String(thrown)}`
        );
    }

    if (!response.ok) {
        // Every failure the API produces has an `error` string, but a proxy or a crash might not, so the
        // status line is the fallback rather than letting a parse failure mask the real problem.
        let message = `${response.status} ${response.statusText}`;
        try {
            const body = (await response.json()) as ErrorResponse;
            if (typeof body.error === "string") message = body.error;
        } catch {
            // Keep the status line.
        }

        throw new ApiError(response.status, message);
    }

    return (await response.json()) as T;
}

/** Fields a write may set. Mirrors what the server accepts, which mirrors what the CLI accepts. */
interface IssueWrite {
    title?: string;
    description?: string;
    plan?: string;
    state?: string;
    /** `null` clears; omitted leaves alone. */
    parent?: number | null;
    assignee?: string | null;
    labels?: string[];
    blockedBy?: number[];
}

export const api = {
    config: (): Promise<ConfigResponse> => request<ConfigResponse>("/config"),

    status: (): Promise<StatusResponse> => request<StatusResponse>("/status"),

    /** The same search the CLI runs, over the same core function on the server. */
    search: (query: string): Promise<SearchResponse> =>
        request<SearchResponse>(`/search?q=${encodeURIComponent(query)}`),

    tree: (ref?: number): Promise<TreeResponse> =>
        request<TreeResponse>(`/tree${ref === undefined ? "" : `?ref=${ref}`}`),

    issues: (filters: Record<string, string> = {}): Promise<IssueListResponse> => {
        const query = new URLSearchParams(filters).toString();
        return request<IssueListResponse>(`/issues${query === "" ? "" : `?${query}`}`);
    },

    issue: (id: number): Promise<IssueResponse> => request<IssueResponse>(`/issues/${id}`),

    create: (body: IssueWrite & { title: string }): Promise<IssueResponse> =>
        request<IssueResponse>("/issues", { method: "POST", body: JSON.stringify(body) }),

    update: (id: number, body: IssueWrite): Promise<IssueResponse> =>
        request<IssueResponse>(`/issues/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

    addNote: (id: number, body: string): Promise<IssueResponse> =>
        request<IssueResponse>(`/issues/${id}/notes`, {
            method: "POST",
            body: JSON.stringify({ body })
        })
};

/** Whether the change stream is currently connected. */
export type Connection = "connecting" | "live" | "lost";

export interface Subscription {
    /** Something in the backlog changed. The server does not say what, so callers re-read. */
    change: () => void;
    /** The stream connected, dropped, or is trying again. */
    connection: (state: Connection) => void;
}

/** How long to wait before re-opening a stream the browser has given up on. */
const REOPEN_AFTER_MS = 3000;

/**
 * Subscribe to backlog changes.
 *
 * The server says only that something changed, so `change` re-fetches rather than patching state from the
 * event. `EventSource` reconnects on its own, which is the reason for choosing SSE: the interesting case is
 * a tab left open while an agent works, and that tab has to survive the server restarting.
 *
 * The connection state is reported because reconnecting silently is worse than not reconnecting at all. A
 * page showing a stale board looks exactly like a page showing a quiet one, and a reader cannot tell the
 * difference between "nothing changed" and "I stopped listening an hour ago".
 *
 * Two kinds of failure, and they need different handling. Usually `EventSource` retries on its own with its
 * own backoff, and this does not interfere. But a response it considers fatal — a 403 from the Host check,
 * say — closes the stream for good, and then nothing recovers it, so it is re-opened here on a slow timer.
 */
export function subscribe({ change, connection }: Subscription): () => void {
    let source: EventSource | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const open = (): void => {
        if (stopped) return;

        connection("connecting");
        source = new EventSource("/api/events");
        source.addEventListener("change", change);
        source.addEventListener("open", () => connection("live"));
        source.addEventListener("error", () => {
            connection("lost");

            // CLOSED means the browser will not try again. Anything else is its own retry in progress.
            if (source?.readyState === EventSource.CLOSED) {
                source.close();
                reopen = setTimeout(open, REOPEN_AFTER_MS);
            }
        });
    };

    open();

    return () => {
        stopped = true;
        if (reopen !== undefined) clearTimeout(reopen);
        source?.removeEventListener("change", change);
        source?.close();
    };
}
