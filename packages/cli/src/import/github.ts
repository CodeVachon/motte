import { spawnSync } from "node:child_process";
import type { GithubComment, GithubIssue } from "@motte/core";

/**
 * Getting the issues out of GitHub.
 *
 * Two ways in, because the people this is for do not all have the same setup. `gh` is the good path — it is
 * already authenticated, it already excludes pull requests, and it knows about sub-issues. The REST API is
 * the fallback for a machine that has a token but not the CLI.
 *
 * Everything here is fetching and normalising. What a GitHub issue *becomes* is decided in core, where it
 * can be tested without a network.
 */

export class ImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImportError";
    }
}

/** Which issues to ask for. */
export interface FetchOptions {
    repo: string;
    state: "open" | "closed" | "all";
    limit: number;
    /** Only issues carrying this label, repeatable. */
    labels?: readonly string[];
}

export interface Fetched {
    issues: GithubIssue[];
    /** How the issues were obtained, for the report — the two paths do not bring back the same detail. */
    via: "gh" | "api";
    /** True when the limit was reached, so the report can say the import is partial. */
    truncated: boolean;
    /** True when sub-issue relationships were not available, so nothing nests. */
    withoutHierarchy: boolean;
}

/** `owner/repo`, which is the only form either path accepts. */
export function parseRepo(value: string): string {
    const trimmed = value
        .trim()
        .replace(/^https:\/\/github\.com\//, "")
        .replace(/\.git$/, "");
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);

    if (match === null) {
        throw new ImportError(
            `"${value}" is not a repository. Give it as owner/repo, for example CodeVachon/motte.`
        );
    }

    return `${match[1]}/${match[2]}`;
}

function ghPresent(): boolean {
    return spawnSync("command", ["-v", "gh"], { shell: true }).status === 0;
}

function token(): string | undefined {
    return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

/**
 * Where the REST API lives.
 *
 * `MOTTE_GITHUB_API` points it somewhere else — at a GitHub Enterprise instance, or at a local server in
 * the tests. Setting it also *selects* the API path: having said which API to talk to, being silently
 * routed through whatever `gh` is authenticated against instead would be the wrong answer.
 */
function apiBase(): { base: string; explicit: boolean } {
    const override = process.env.MOTTE_GITHUB_API?.trim();

    return override === undefined || override.length === 0
        ? { base: "https://api.github.com", explicit: false }
        : { base: override.replace(/\/$/, ""), explicit: true };
}

/**
 * The fields `gh` is asked for.
 *
 * `parent` is the newest of these and the one an older `gh` will reject — and it rejects the whole call
 * rather than the unknown field, so the request is retried without it rather than failing the import over
 * a nicety.
 */
const CORE_FIELDS = [
    "number",
    "title",
    "body",
    "state",
    "stateReason",
    "assignees",
    "labels",
    "createdAt",
    "updatedAt",
    "comments"
];
const HIERARCHY_FIELD = "parent";

interface GhIssue {
    number: number;
    title: string;
    body?: string;
    state: string;
    stateReason?: string;
    assignees?: { login?: string }[];
    labels?: { name?: string }[];
    createdAt?: string;
    updatedAt?: string;
    comments?: {
        author?: { login?: string } | null;
        body?: string;
        createdAt?: string;
        isMinimized?: boolean;
    }[];
    parent?: { number?: number } | null;
    url?: string;
}

function normaliseGh(issue: GhIssue): GithubIssue {
    const comments: GithubComment[] = (issue.comments ?? []).map((comment) => ({
        ...(comment.author?.login === undefined ? {} : { author: comment.author.login }),
        body: comment.body ?? "",
        ...(comment.createdAt === undefined ? {} : { createdAt: comment.createdAt }),
        ...(comment.isMinimized === undefined ? {} : { minimized: comment.isMinimized })
    }));

    return {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        stateReason: issue.stateReason,
        assignees: (issue.assignees ?? [])
            .map((who) => who.login)
            .filter((login): login is string => login !== undefined),
        labels: (issue.labels ?? [])
            .map((label) => label.name)
            .filter((name): name is string => name !== undefined),
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        comments,
        ...(issue.parent?.number === undefined ? {} : { parent: issue.parent.number }),
        ...(issue.url === undefined ? {} : { url: issue.url })
    };
}

function runGh(
    options: FetchOptions,
    fields: string[]
): { ok: true; out: string } | { ok: false; error: string } {
    const argv = [
        "issue",
        "list",
        "--repo",
        options.repo,
        "--state",
        options.state,
        "--limit",
        String(options.limit),
        "--json",
        fields.join(",")
    ];

    for (const label of options.labels ?? []) argv.push("--label", label);

    const result = spawnSync("gh", argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

    if (result.error !== undefined) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
        return { ok: false, error: (result.stderr || result.stdout || "").trim() };
    }

    return { ok: true, out: result.stdout };
}

function fetchViaGh(options: FetchOptions): Fetched {
    let withoutHierarchy = false;
    let result = runGh(options, [...CORE_FIELDS, HIERARCHY_FIELD]);

    if (!result.ok) {
        // Retried without the newest field before giving up: a `gh` that does not know `parent` can still
        // do everything else, and losing the nesting is much better than losing the import.
        const retry = runGh(options, CORE_FIELDS);
        if (!retry.ok) throw new ImportError(`gh could not list the issues: ${result.error}`);

        result = retry;
        withoutHierarchy = true;
    }

    let parsed: GhIssue[];
    try {
        parsed = JSON.parse(result.out) as GhIssue[];
    } catch (thrown) {
        throw new ImportError(
            `gh returned something that is not JSON: ${thrown instanceof Error ? thrown.message : String(thrown)}`
        );
    }

    return {
        issues: parsed.map(normaliseGh),
        via: "gh",
        truncated: parsed.length >= options.limit,
        withoutHierarchy
    };
}

// ------------------------------------------------------------------- REST API

interface ApiIssue {
    number: number;
    title: string;
    body?: string | null;
    state: string;
    state_reason?: string | null;
    assignees?: { login?: string }[] | null;
    labels?: ({ name?: string } | string)[] | null;
    created_at?: string;
    updated_at?: string;
    comments?: number;
    /** Present only on pull requests, which the issues endpoint returns alongside issues. */
    pull_request?: unknown;
    html_url?: string;
}

interface ApiComment {
    user?: { login?: string } | null;
    body?: string | null;
    created_at?: string;
}

async function json<T>(url: string, auth: string): Promise<T> {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${auth}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "motte"
        }
    });

    if (!response.ok) {
        throw new ImportError(
            `GitHub answered ${response.status} for ${url}` +
                (response.status === 401 || response.status === 403
                    ? " — check that GITHUB_TOKEN can read that repository."
                    : "")
        );
    }

    return (await response.json()) as T;
}

function labelNames(labels: ApiIssue["labels"]): string[] {
    return (labels ?? [])
        .map((label) => (typeof label === "string" ? label : label.name))
        .filter((name): name is string => name !== undefined);
}

/**
 * The fallback: a token and `fetch`.
 *
 * Two things the `gh` path gets for free have to be handled here. The issues endpoint returns pull requests
 * as issues, which would import somebody's whole PR history as work to do — they are told apart by the
 * `pull_request` key. And comments are a separate request per issue, so an issue with none is not asked
 * about at all.
 *
 * Sub-issues are not in this payload, so nothing nests on this path.
 */
async function fetchViaApi(options: FetchOptions, auth: string, base: string): Promise<Fetched> {
    const issues: GithubIssue[] = [];
    const perPage = Math.min(100, options.limit);
    let page = 1;

    while (issues.length < options.limit) {
        const query = new URLSearchParams({
            state: options.state,
            per_page: String(perPage),
            page: String(page)
        });
        if ((options.labels ?? []).length > 0)
            query.set("labels", (options.labels ?? []).join(","));

        const batch = await json<ApiIssue[]>(
            `${base}/repos/${options.repo}/issues?${query.toString()}`,
            auth
        );

        if (batch.length === 0) break;

        for (const issue of batch) {
            if (issue.pull_request !== undefined) continue;
            if (issues.length >= options.limit) break;

            const comments: GithubComment[] =
                (issue.comments ?? 0) === 0
                    ? []
                    : (
                          await json<ApiComment[]>(
                              `${base}/repos/${options.repo}/issues/${issue.number}/comments?per_page=100`,
                              auth
                          )
                      ).map((comment) => ({
                          ...(comment.user?.login === undefined
                              ? {}
                              : { author: comment.user.login }),
                          body: comment.body ?? "",
                          ...(comment.created_at === undefined
                              ? {}
                              : { createdAt: comment.created_at })
                      }));

            issues.push({
                number: issue.number,
                title: issue.title,
                body: issue.body,
                state: issue.state,
                stateReason: issue.state_reason,
                assignees: (issue.assignees ?? [])
                    .map((who) => who.login)
                    .filter((login): login is string => login !== undefined),
                labels: labelNames(issue.labels),
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
                comments,
                ...(issue.html_url === undefined ? {} : { url: issue.html_url })
            });
        }

        if (batch.length < perPage) break;
        page += 1;
    }

    return {
        issues,
        via: "api",
        truncated: issues.length >= options.limit,
        withoutHierarchy: true
    };
}

/**
 * Fetch, by whichever route is available.
 *
 * `gh` first even when a token is set: it brings back more, and it is already authenticated for whatever
 * the user has access to.
 */
export async function fetchIssues(options: FetchOptions): Promise<Fetched> {
    const api = apiBase();
    const auth = token();

    if (!api.explicit && ghPresent()) {
        try {
            return fetchViaGh(options);
        } catch (thrown) {
            // gh is installed but cannot do it, and unauthenticated is the usual reason — a machine with a
            // token in the environment and a gh nobody logged into is an ordinary CI setup. Falling back
            // beats failing. Without a token there is nothing to fall back to, so gh's own error stands,
            // and it is the one that tells the user to run `gh auth login`.
            if (auth === undefined) throw thrown;
        }
    }

    if (auth === undefined) {
        throw new ImportError(
            api.explicit
                ? `MOTTE_GITHUB_API is set to ${api.base}, but GITHUB_TOKEN is not — that path needs a token.`
                : "no way to reach GitHub: the gh CLI is not installed and GITHUB_TOKEN is not set.\n" +
                      "  Install gh (https://cli.github.com) and run `gh auth login`, or export a token that can read the repository."
        );
    }

    return fetchViaApi(options, auth, api.base);
}
