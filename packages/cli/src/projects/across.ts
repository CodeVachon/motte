import { CONFIG_FILENAME, IssueStore, loadConfigFrom, type Config, type Issue } from "@motte/core";
import { join } from "node:path";
import { listProjects, type RegisteredProject } from "./registry.js";

/**
 * Reading every registered project at once.
 *
 * The registry stores summaries, which is enough for `motte projects` but not for a question about
 * individual issues — "what is assigned to me everywhere" needs the issues themselves. So `--all` reads
 * each project fresh. That is a directory scan per project rather than a query, which at the scale this
 * registry describes (a few dozen projects, a few dozen issues each) is a few milliseconds and keeps the
 * committed files as the only source of truth.
 */

export interface OpenProject {
    root: string;
    name: string;
    config: Config;
    issues: Issue[];
}

export interface AcrossProjects {
    projects: OpenProject[];
    /** Registered but not readable now: moved, deleted, or on a volume that is not mounted. */
    unreadable: RegisteredProject[];
}

export function openProjects(): AcrossProjects {
    const projects: OpenProject[] = [];
    const unreadable: RegisteredProject[] = [];

    for (const registered of listProjects()) {
        if (registered.missing) {
            unreadable.push(registered);
            continue;
        }

        try {
            const config = loadConfigFrom(join(registered.root, CONFIG_FILENAME));
            projects.push({
                root: registered.root,
                name: config.name,
                config,
                issues: new IssueStore(config).all()
            });
        } catch {
            // One unparseable config must not stop the other projects from being reported.
            unreadable.push(registered);
        }
    }

    return { projects, unreadable };
}

export interface AcrossTotals {
    projects: number;
    issues: number;
    counted: number;
    done: number;
    started: number;
    percent: number;
}

/**
 * The combined progress.
 *
 * Summed over issues rather than averaged over projects: a project with two issues and one with two
 * hundred do not count equally towards "how much of my work is done", and averaging percentages would say
 * they do.
 */
export function totals(
    projects: readonly OpenProject[],
    counts: readonly Progressish[]
): AcrossTotals {
    const sum = (pick: (progress: Progressish) => number): number =>
        counts.reduce((total, progress) => total + pick(progress), 0);

    const counted = sum((progress) => progress.counted);
    const done = sum((progress) => progress.completed);

    return {
        projects: projects.length,
        issues: sum((progress) => progress.total),
        counted,
        done,
        started: sum((progress) => progress.started),
        percent: counted === 0 ? 100 : Math.round((done / counted) * 100)
    };
}

/** Just the parts of a progress report the totals need. */
export interface Progressish {
    total: number;
    counted: number;
    completed: number;
    started: number;
}
