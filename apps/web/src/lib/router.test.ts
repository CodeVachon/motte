import { describe, expect, it } from "vitest";
import { href, parseRoute } from "./router.js";

/**
 * The routing table. Hand-rolled, so it gets tested rather than trusted.
 *
 * `navigate` and `useRoute` are not covered here: they are thin wrappers over history and event listeners,
 * and the Playwright pass exercises them through the real thing rather than a jsdom imitation of it.
 */
describe("parseRoute", () => {
    it("treats the root as the board", () => {
        expect(parseRoute("/")).toEqual({ name: "board" });
        expect(parseRoute("")).toEqual({ name: "board" });
        expect(parseRoute("/board")).toEqual({ name: "board" });
    });

    it("recognises the other views", () => {
        expect(parseRoute("/tree")).toEqual({ name: "tree" });
        expect(parseRoute("/reports")).toEqual({ name: "reports" });
    });

    it("reads an issue id as a number", () => {
        expect(parseRoute("/issues/12")).toEqual({ name: "issue", id: 12 });
        expect(parseRoute("/issues/0007")).toEqual({ name: "issue", id: 7 });
    });

    /** Trailing slashes are the same route, since a browser or a hand-typed URL may carry one. */
    it("ignores a trailing slash", () => {
        expect(parseRoute("/tree/")).toEqual({ name: "tree" });
        expect(parseRoute("/issues/12/")).toEqual({ name: "issue", id: 12 });
    });

    it("does not mistake a non-numeric reference for an issue", () => {
        expect(parseRoute("/issues/abc")).toEqual({ name: "unknown", path: "/issues/abc" });
        expect(parseRoute("/issues")).toEqual({ name: "unknown", path: "/issues" });
    });

    it("reports anything else as unknown, keeping the path for the message", () => {
        expect(parseRoute("/nope")).toEqual({ name: "unknown", path: "/nope" });
    });
});

describe("href", () => {
    it("round-trips every route", () => {
        for (const route of [
            { name: "board" } as const,
            { name: "tree" } as const,
            { name: "reports" } as const,
            { name: "issue", id: 42 } as const
        ]) {
            expect(parseRoute(href(route))).toEqual(route);
        }
    });

    it("gives the board the root path rather than /board", () => {
        // Both parse to the board, but only one should appear in a URL bar.
        expect(href({ name: "board" })).toBe("/");
    });
});
