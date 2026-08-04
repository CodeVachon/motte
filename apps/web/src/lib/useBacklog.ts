import { useCallback, useEffect, useRef, useState } from "react";
import {
    ApiError,
    api,
    subscribe,
    type ConfigResponse,
    type IssueResponse,
    type StatusResponse
} from "./api.js";

/**
 * The whole backlog, kept current.
 *
 * One fetch of everything rather than per-view queries. A backlog is a few dozen files — this project's own
 * is under a hundred — so the entire list is smaller than most single API responses on the web, and holding
 * it means the board, the tree and an issue page all read from the same snapshot and cannot disagree about
 * what state something is in.
 *
 * Re-fetch on any change rather than patching from the event: the server reports that the backlog moved, not
 * what moved, so there is nothing to patch from. That is deliberate — see `core/watch.ts`.
 */

export interface Backlog {
    config: ConfigResponse | undefined;
    issues: IssueResponse[];
    status: StatusResponse | undefined;
    /** Set when the last load failed. The views keep showing the previous data underneath. */
    error: string | undefined;
    loading: boolean;
    /** Re-read everything. Called after a write, and whenever the server says something changed. */
    reload: () => Promise<void>;
    /** Apply a write, then reload. Errors surface through `error` rather than being thrown at the caller. */
    mutate: (change: () => Promise<unknown>) => Promise<boolean>;
}

export function useBacklog(): Backlog {
    const [config, setConfig] = useState<ConfigResponse | undefined>(undefined);
    const [issues, setIssues] = useState<IssueResponse[]>([]);
    const [status, setStatus] = useState<StatusResponse | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(true);

    // A reload triggered by an SSE event can land after the component has gone. Writing state then is
    // harmless in React 18+ but still noise, and skipping it keeps the effect honest about its lifetime.
    const live = useRef(true);
    useEffect(() => {
        live.current = true;
        return () => {
            live.current = false;
        };
    }, []);

    const reload = useCallback(async () => {
        try {
            const [nextConfig, nextIssues, nextStatus] = await Promise.all([
                api.config(),
                api.issues(),
                api.status()
            ]);

            if (!live.current) return;

            setConfig(nextConfig);
            setIssues(nextIssues.issues);
            setStatus(nextStatus);
            setError(undefined);
        } catch (thrown) {
            if (!live.current) return;
            setError(thrown instanceof ApiError ? thrown.message : String(thrown));
        } finally {
            if (live.current) setLoading(false);
        }
    }, []);

    const mutate = useCallback(
        async (change: () => Promise<unknown>): Promise<boolean> => {
            try {
                await change();
            } catch (thrown) {
                // A rejected write is the common way to meet a real rule — a cycle, an unknown state — so
                // it belongs on screen, not in the console.
                setError(thrown instanceof ApiError ? thrown.message : String(thrown));
                return false;
            }

            // The write already changed the files, so the watcher will push a change too. Reloading here as
            // well means the UI does not wait on the filesystem to notice.
            await reload();
            return true;
        },
        [reload]
    );

    useEffect(() => {
        void reload();
        return subscribe(() => void reload());
    }, [reload]);

    return { config, issues, status, error, loading, reload, mutate };
}

/** Group issues into the project's configured states, keeping every state even when empty. */
export function byState(
    config: ConfigResponse,
    issues: IssueResponse[]
): { state: string; category: string; issues: IssueResponse[] }[] {
    return config.states.map((state) => ({
        state: state.name,
        category: state.category,
        issues: issues.filter((issue) => issue.state === state.name)
    }));
}

/** The colour class for a state category, so a column reflects meaning rather than a state's name. */
export function categoryColour(category: string): string {
    switch (category) {
        case "started":
            return "bg-started";
        case "completed":
            return "bg-completed";
        case "cancelled":
            return "bg-cancelled";
        default:
            return "bg-unstarted";
    }
}
