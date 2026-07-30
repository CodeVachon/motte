import { REPO } from "./layout.js";

export class ReleaseLookupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReleaseLookupError";
    }
}

interface ApiRelease {
    tag_name?: string;
    prerelease?: boolean;
    draft?: boolean;
}

async function api(url: string): Promise<{ status: number; body: string }> {
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "motte" }
        });
    } catch (error) {
        throw new ReleaseLookupError(
            `could not reach the GitHub API: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    return { status: response.status, body: await response.text() };
}

/**
 * Resolve the version to install.
 *
 * Mirrors install.sh: prefer a stable release, and fall back to the newest of any kind. GitHub's
 * `/releases/latest` deliberately excludes prereleases, so while motte is pre-1.0 that endpoint 404s
 * and the fallback is the only path that finds anything. Getting this wrong is what broke the hosted
 * installer on the first real release, so both implementations must agree.
 */
export async function resolveLatestVersion(): Promise<string> {
    const stable = await api(`https://api.github.com/repos/${REPO}/releases/latest`);

    if (stable.status === 200) {
        const tag = (JSON.parse(stable.body) as ApiRelease).tag_name;
        if (tag !== undefined && tag.length > 0) return tag;
    }

    if (isRateLimited(stable)) throw rateLimitError();

    const all = await api(`https://api.github.com/repos/${REPO}/releases`);
    if (isRateLimited(all)) throw rateLimitError();

    if (all.status !== 200) {
        throw new ReleaseLookupError(
            `the GitHub API returned ${all.status} when listing releases. ` +
                `Pass a version explicitly to skip the lookup: motte upgrade 0.1.0`
        );
    }

    let releases: ApiRelease[];
    try {
        releases = JSON.parse(all.body) as ApiRelease[];
    } catch {
        throw new ReleaseLookupError("the GitHub API returned something that was not JSON");
    }

    // Drafts have no downloadable assets, so skipping them here avoids a confusing 404 later.
    const usable = releases.find(
        (release) => release.draft !== true && (release.tag_name ?? "").length > 0
    );

    if (usable?.tag_name === undefined) {
        throw new ReleaseLookupError(
            `no published release was found for ${REPO}. ` +
                `Pass a version explicitly to skip the lookup: motte upgrade 0.1.0`
        );
    }

    return usable.tag_name;
}

function isRateLimited(response: { status: number; body: string }): boolean {
    return (
        (response.status === 403 || response.status === 429) &&
        response.body.toLowerCase().includes("rate limit")
    );
}

function rateLimitError(): ReleaseLookupError {
    return new ReleaseLookupError(
        "GitHub API rate limit reached. Unauthenticated requests are capped at 60 per hour per IP. " +
            "Retry later, or pass a version explicitly: motte upgrade 0.1.0"
    );
}
