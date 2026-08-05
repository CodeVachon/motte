import {
    CONFIG_FILENAME,
    IssueStore,
    loadConfigFrom,
    watchBacklog,
    type Config,
    type Snapshot
} from "@motte/core";
import { join } from "node:path";
import { listProjects } from "../projects/registry.js";
import type { WatchSource } from "./run.js";

/**
 * Which projects a watch is watching.
 *
 * One is whatever `motte` found by walking up from the working directory. `--all` is every project the
 * registry knows about, which is the case the dashboard was built for: several agents at once are rarely
 * all in one repository.
 */

/**
 * How many to watch at once, unless told otherwise.
 *
 * Each source opens filesystem watchers and re-parses a backlog on every write, so forty registered
 * projects would mean forty of each. A machine that has accumulated that many mostly has projects nobody
 * has touched in months — so the newest are kept and the frame says how many were left, rather than
 * quietly opening all of them or quietly showing a subset.
 */
export const DEFAULT_LIMIT = 8;

export interface Collected {
    sources: WatchSource[];
    /** Registered projects deliberately not watched, because of the limit. */
    omitted: number;
    /** Registered projects skipped because their config has gone or will not load. */
    unreadable: { name: string; root: string; reason: string }[];
}

/**
 * A source that re-reads from scratch each time, which is the whole job here.
 *
 * Shared with `motte watch`'s own project, which built the identical object from a config it had already
 * discovered — fallow caught the two as a clone group. The only difference was where the config came from,
 * so that is the only thing the caller supplies.
 */
export function sourceFrom(config: Config, watching: boolean): WatchSource {
    return {
        name: config.name,
        config,
        // A fresh store per read, because the caching one keys parses by mtime and the whole job here is
        // to notice writes as they land.
        read: (): Snapshot => {
            const store = new IssueStore(config);
            return { issues: store.all(), events: store.events().events };
        },
        ...(watching
            ? { watch: (onChange: () => void) => watchBacklog(config, () => onChange()) }
            : {})
    };
}

/**
 * The config is loaded once: the states and the issues directory, not the contents. A config that changes
 * under a running watch is rare enough that restarting is the honest answer.
 */
function sourceFor(root: string, watching: boolean): WatchSource {
    return sourceFrom(loadConfigFrom(join(root, CONFIG_FILENAME)), watching);
}

export interface CollectOptions {
    /** False when polling: watchers and an interval are alternatives, not both. */
    watching: boolean;
    /** How many projects to open at once. */
    limit?: number;
}

/**
 * Every registered project that can be read, newest first, up to the limit.
 *
 * A project whose config has gone or will not parse is reported rather than watched — the registry is a
 * convenience built on top of the files, and a stale entry in it must not stop the others being watched.
 */
export function collectAll(options: CollectOptions): Collected {
    const limit = options.limit ?? DEFAULT_LIMIT;

    const sources: WatchSource[] = [];
    const unreadable: Collected["unreadable"] = [];
    let omitted = 0;

    for (const project of listProjects()) {
        if (project.missing) {
            unreadable.push({
                name: project.name,
                root: project.root,
                reason: "no config file there any more"
            });
            continue;
        }

        // Counted rather than derived from the difference: a project that failed to load is unreadable, not
        // omitted, and subtracting one total from another would report it as both.
        if (sources.length >= limit) {
            omitted += 1;
            continue;
        }

        try {
            sources.push(sourceFor(project.root, options.watching));
        } catch (thrown) {
            unreadable.push({
                name: project.name,
                root: project.root,
                reason: thrown instanceof Error ? thrown.message : String(thrown)
            });
        }
    }

    return { sources, omitted, unreadable };
}
