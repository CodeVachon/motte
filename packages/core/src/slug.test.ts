import { describe, expect, it } from "vitest";
import { idFromFilename, issueFilename, padId, slugify } from "./slug.js";

describe("padId", () => {
    it("pads to four digits so files sort in id order", () => {
        expect(padId(1)).toBe("0001");
        expect(padId(42)).toBe("0042");
        expect(padId(1234)).toBe("1234");
    });

    it("does not truncate ids past the pad width", () => {
        expect(padId(12345)).toBe("12345");
    });
});

describe("slugify", () => {
    it("lowercases and hyphenates", () => {
        expect(slugify("Design the Schema")).toBe("design-the-schema");
    });

    it("strips punctuation and collapses separators", () => {
        expect(slugify("parseIssueFile & formatIssueFile: round-trip!")).toBe(
            "parseissuefile-formatissuefile-round-trip"
        );
    });

    it("folds accents rather than dropping the letter", () => {
        expect(slugify("Café résumé")).toBe("cafe-resume");
    });

    it("drops leading and trailing separators", () => {
        expect(slugify("  --- hello ---  ")).toBe("hello");
    });

    it("handles an em dash the way titles in this repo use it", () => {
        expect(slugify("resolveRef — id or title fragment")).toBe(
            "resolveref-id-or-title-fragment"
        );
    });

    it("truncates long titles without leaving a trailing hyphen", () => {
        const slug = slugify("a".repeat(40) + " " + "b".repeat(40));
        expect(slug.length).toBeLessThanOrEqual(60);
        expect(slug.endsWith("-")).toBe(false);
    });

    it("falls back to a placeholder when nothing survives", () => {
        expect(slugify("!!!")).toBe("issue");
        expect(slugify("")).toBe("issue");
        expect(slugify("日本語")).toBe("issue");
    });
});

describe("issueFilename", () => {
    it("joins the padded id and the slug", () => {
        expect(issueFilename(12, "Round-trip the format")).toBe("0012-round-trip-the-format.md");
    });
});

describe("idFromFilename", () => {
    it("reads the id back", () => {
        expect(idFromFilename("0012-round-trip.md")).toBe(12);
        expect(idFromFilename("1234-x.md")).toBe(1234);
    });

    it("returns undefined for names motte did not write", () => {
        expect(idFromFilename("notes.md")).toBeUndefined();
        expect(idFromFilename("0012-no-extension")).toBeUndefined();
        expect(idFromFilename("README.md")).toBeUndefined();
    });

    it("round-trips with issueFilename", () => {
        expect(idFromFilename(issueFilename(7, "Anything at all"))).toBe(7);
    });
});
