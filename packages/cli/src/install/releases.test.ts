import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLatestVersion } from "./releases.js";

/**
 * `resolveLatestVersion`, the function whose behaviour broke the hosted installer on the first real
 * release.
 *
 * GitHub's `/releases/latest` deliberately excludes prereleases, so while motte is pre-1.0 it 404s and the
 * fallback listing is the only path that finds anything. `install.sh` does the same two-step, and the two
 * have to agree — the comment in the source said so while the implementation did the opposite.
 *
 * Driven by stubbing global `fetch`, which is what `api()` calls. No env seam had to be added to the
 * production code to make this testable.
 */

interface Reply {
    status: number;
    body: string;
}

/** Answer the two API calls in order, and record the URLs asked for. */
function stubApi(...replies: Reply[]): { urls: string[] } {
    const urls: string[] = [];
    let call = 0;

    vi.stubGlobal("fetch", (url: string) => {
        urls.push(String(url));
        const reply = replies[call] ?? replies[replies.length - 1]!;
        call += 1;
        return Promise.resolve({ status: reply.status, text: () => Promise.resolve(reply.body) });
    });

    return { urls };
}

const ok = (body: unknown): Reply => ({ status: 200, body: JSON.stringify(body) });
const notFound: Reply = { status: 404, body: '{"message":"Not Found"}' };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("resolveLatestVersion", () => {
    it("returns the stable release when there is one, without listing", async () => {
        const { urls } = stubApi(ok({ tag_name: "v1.2.0" }));

        expect(await resolveLatestVersion()).toBe("v1.2.0");
        expect(urls).toHaveLength(1);
        expect(urls[0]).toMatch(/\/releases\/latest$/);
    });

    /**
     * The pre-1.0 path, and the one that actually shipped broken. `/releases/latest` 404s because every
     * release so far is a prerelease, so the answer has to come from the listing.
     */
    it("falls back to the listing when /releases/latest 404s", async () => {
        const { urls } = stubApi(notFound, ok([{ tag_name: "v0.2.0", prerelease: true }]));

        expect(await resolveLatestVersion()).toBe("v0.2.0");
        expect(urls).toHaveLength(2);
        expect(urls[1]).toMatch(/\/releases$/);
    });

    it("takes the newest usable release, which the API returns first", async () => {
        stubApi(
            notFound,
            ok([
                { tag_name: "v0.3.0", prerelease: true },
                { tag_name: "v0.2.0", prerelease: true }
            ])
        );

        expect(await resolveLatestVersion()).toBe("v0.3.0");
    });

    /** Drafts have no downloadable assets, so choosing one would 404 later at download time. */
    it("skips drafts", async () => {
        stubApi(
            notFound,
            ok([
                { tag_name: "v0.4.0", draft: true },
                { tag_name: "v0.3.0", prerelease: true }
            ])
        );

        expect(await resolveLatestVersion()).toBe("v0.3.0");
    });

    it("skips a release with no tag", async () => {
        stubApi(notFound, ok([{ prerelease: true }, { tag_name: "v0.1.0" }]));

        expect(await resolveLatestVersion()).toBe("v0.1.0");
    });

    /** A 200 with no usable tag must not be trusted as an answer. */
    it("falls through when the stable endpoint answers 200 with an empty tag", async () => {
        const { urls } = stubApi(ok({ tag_name: "" }), ok([{ tag_name: "v0.9.0" }]));

        expect(await resolveLatestVersion()).toBe("v0.9.0");
        expect(urls).toHaveLength(2);
    });

    it("reports that nothing is published when the listing is empty", async () => {
        stubApi(notFound, ok([]));

        await expect(resolveLatestVersion()).rejects.toThrow(/no published release/);
    });

    it("reports the status when the listing fails, and suggests passing a version", async () => {
        stubApi(notFound, { status: 500, body: "boom" });

        await expect(resolveLatestVersion()).rejects.toThrow(
            /returned 500 when listing releases.*motte upgrade/s
        );
    });

    it("reports a body that is not JSON as such", async () => {
        stubApi(notFound, { status: 200, body: "<html>nope</html>" });

        await expect(resolveLatestVersion()).rejects.toThrow(/not JSON/);
    });

    /**
     * Rate limiting is worth its own message: unauthenticated requests are capped at 60 an hour per IP, so
     * a developer hitting it needs to know waiting will fix it.
     */
    it("recognises a rate limit on the first call and does not try the second", async () => {
        const { urls } = stubApi({
            status: 403,
            body: '{"message":"API rate limit exceeded for 1.2.3.4"}'
        });

        await expect(resolveLatestVersion()).rejects.toThrow(/rate limit/i);
        expect(urls).toHaveLength(1);
    });

    it("recognises a rate limit on the listing call", async () => {
        stubApi(notFound, { status: 429, body: '{"message":"You have exceeded a rate limit"}' });

        await expect(resolveLatestVersion()).rejects.toThrow(/rate limit/i);
    });

    /** A 403 that is not about rate limiting must not be mislabelled as one. */
    it("does not treat every 403 as a rate limit", async () => {
        stubApi(
            { status: 403, body: '{"message":"Forbidden"}' },
            { status: 403, body: "Forbidden" }
        );

        await expect(resolveLatestVersion()).rejects.toThrow(/returned 403 when listing/);
    });

    it("reports an unreachable API rather than throwing a bare network error", async () => {
        vi.stubGlobal("fetch", () => Promise.reject(new Error("getaddrinfo ENOTFOUND")));

        await expect(resolveLatestVersion()).rejects.toThrow(
            /could not reach the GitHub API.*ENOTFOUND/s
        );
    });
});
