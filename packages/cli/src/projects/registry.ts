import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    CONFIG_FILENAME,
    projectReport,
    ready,
    stateCategory,
    timestamp,
    type Config,
    type Issue
} from "@motte/core";

/**
 * Which projects this machine has seen.
 *
 * The backlog files answer everything about one project and nothing about several. This is the missing
 * half: what is assigned to me everywhere, what is in flight across all of my work, and where I left off.
 * Additive rather than a mirror — it holds what a committed file structurally cannot, namely the fact that
 * these repositories are all mine.
 *
 * #0045 called for `~/.motte/index.db`, and this is a JSON file instead. The stored data is one summary row
 * per project — a few dozen on a busy machine — and SQL buys nothing at that size. It also has to be
 * testable, and `bun:sqlite` is a Bun global while vitest runs on Node, which this project has been caught
 * by more than once; `node:sqlite` is still experimental and version-dependent. A JSON file is readable and
 * repairable by hand, which is the same argument the issue format itself rests on.
 *
 * The cost is honest: two motte processes registering in the same instant can lose one of the two updates.
 * Writes are atomic, so the file is never torn, and a lost registration self-heals the next time a command
 * runs in that project.
 */

/** What is kept about one project. Deliberately a summary: no titles beyond what is in flight, no bodies. */
export interface ProjectSummary {
    /** The directory holding `.motte.config.json`. The identity of the entry. */
    root: string;
    name: string;
    issues: number;
    done: number;
    /** Issues counted towards progress, which excludes cancelled work. */
    counted: number;
    percent: number;
    ready: number;
    /** Started work, which is the only per-issue detail worth keeping here. */
    inFlight: { id: number; title: string; state: string; assignee?: string | undefined }[];
    /** When motte last ran in it — the "where did I leave off" field. */
    seen: string;
}

export interface RegisteredProject extends ProjectSummary {
    /** True when the config file is no longer where the entry says it is. */
    missing: boolean;
}

interface RegistryFile {
    projects: ProjectSummary[];
}

/**
 * Where the registry lives.
 *
 * Beside the wiring record under the install root, because both describe this machine rather than any one
 * project, and both should go when motte is uninstalled.
 */
export function registryPath(env: NodeJS.ProcessEnv = process.env): string {
    const root = env.MOTTE_INSTALL_DIR ?? join(env.HOME ?? env.USERPROFILE ?? ".", ".motte");
    return join(root, "projects.json");
}

export function readProjects(path: string = registryPath()): ProjectSummary[] {
    if (!existsSync(path)) return [];

    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
        return Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch {
        // A corrupt registry is a cache, not a record. Starting over beats refusing to run a command.
        return [];
    }
}

function writeProjects(projects: ProjectSummary[], path: string = registryPath()): void {
    mkdirSync(dirname(path), { recursive: true });

    // Temp file and rename, so a reader never sees half a file — the same approach the issue store takes.
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
    renameSync(temp, path);
}

/** The summary of a project as it stands. */
export function summarise(
    config: Config,
    issues: Issue[],
    at: string = timestamp()
): ProjectSummary {
    const report = projectReport(config, issues);

    return {
        root: config.root,
        name: config.name,
        issues: issues.length,
        done: report.completed,
        counted: report.counted,
        percent: report.percentComplete,
        // From `deps` rather than the report, which does not carry it: readiness is computed across the
        // whole backlog, so it is not a field of a per-state rollup.
        ready: ready(config, issues).length,
        inFlight: issues
            .filter((issue) => stateCategory(config, issue.state) === "started")
            .map((issue) => ({
                id: issue.id,
                title: issue.title,
                state: issue.state,
                assignee: issue.assignee
            })),
        seen: at
    };
}

/** Whether anything but the timestamp differs, which is what decides if a write is worth doing. */
function sameExceptSeen(a: ProjectSummary | undefined, b: ProjectSummary): boolean {
    if (a === undefined) return false;

    const { seen: _a, ...left } = a;
    const { seen: _b, ...right } = b;

    return JSON.stringify(left) === JSON.stringify(right);
}

/** How stale the `seen` timestamp may get before a command refreshes it. */
const REFRESH_AFTER_MS = 60_000;

export interface RememberOptions {
    path?: string;
    /** Write even when nothing has changed and the entry is recent. */
    force?: boolean;
    now?: () => number;
}

/**
 * Record that motte ran in this project.
 *
 * Called from `context`, so it happens on any command that opens a project. It writes only when something
 * has actually changed or the entry has gone stale, because a read-only command should not rewrite a file
 * in the home directory every time it runs.
 */
export function rememberProject(
    summary: ProjectSummary,
    options: RememberOptions = {}
): "written" | "skipped" {
    const path = options.path ?? registryPath();
    const projects = readProjects(path);
    const existing = projects.find((project) => project.root === summary.root);

    const now = options.now?.() ?? Date.now();
    const age = existing === undefined ? Infinity : now - Date.parse(existing.seen);

    if (
        options.force !== true &&
        sameExceptSeen(existing, summary) &&
        Number.isFinite(age) &&
        age < REFRESH_AFTER_MS
    ) {
        return "skipped";
    }

    writeProjects(
        [...projects.filter((project) => project.root !== summary.root), summary].sort((a, b) =>
            a.root.localeCompare(b.root)
        ),
        path
    );

    return "written";
}

/**
 * Every registered project, most recently seen first.
 *
 * An entry whose config file has gone is marked rather than dropped: a project on a volume that is not
 * mounted right now has not stopped existing, and forgetting it silently would be the wrong call for a
 * registry whose whole purpose is remembering.
 */
export function listProjects(path: string = registryPath()): RegisteredProject[] {
    return readProjects(path)
        .map((project) => ({
            ...project,
            missing: !existsSync(join(project.root, CONFIG_FILENAME))
        }))
        .sort((a, b) => b.seen.localeCompare(a.seen));
}

/** Drop the entries whose projects are gone. Returns what was removed. */
export function forgetMissing(path: string = registryPath()): RegisteredProject[] {
    const all = listProjects(path);
    const gone = all.filter((project) => project.missing);

    if (gone.length > 0) {
        writeProjects(
            all.filter((project) => !project.missing).map(({ missing: _missing, ...rest }) => rest),
            path
        );
    }

    return gone;
}

/** Forget one project by root, whether or not it still exists. */
export function forgetProject(root: string, path: string = registryPath()): boolean {
    const projects = readProjects(path);
    const remaining = projects.filter((project) => project.root !== root);

    if (remaining.length === projects.length) return false;

    writeProjects(remaining, path);
    return true;
}
