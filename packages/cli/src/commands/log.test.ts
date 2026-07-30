import { describe, expect, it } from "vitest";
import { formatDuration, parseSince } from "./log.js";

describe("parseSince", () => {
    const now = new Date("2026-07-30T12:00:00Z");

    it("reads a relative span", () => {
        expect(parseSince("1h", now)).toBe("2026-07-30T11:00:00Z");
        expect(parseSince("7d", now)).toBe("2026-07-23T12:00:00Z");
        expect(parseSince("30m", now)).toBe("2026-07-30T11:30:00Z");
        expect(parseSince("2w", now)).toBe("2026-07-16T12:00:00Z");
        expect(parseSince("45s", now)).toBe("2026-07-30T11:59:15Z");
    });

    it("tolerates surrounding whitespace", () => {
        expect(parseSince("  7d  ", now)).toBe("2026-07-23T12:00:00Z");
    });

    it("reads an absolute date", () => {
        expect(parseSince("2026-07-01", now)).toBe("2026-07-01T00:00:00Z");
    });

    it("reads a full timestamp", () => {
        expect(parseSince("2026-07-01T08:30:00Z", now)).toBe("2026-07-01T08:30:00Z");
    });

    it("returns the same second-precision format the log uses, so string comparison works", () => {
        // Events are compared as strings, so the cutoff has to be shaped identically.
        expect(parseSince("1d", now)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("explains an input it cannot read", () => {
        expect(() => parseSince("yesterdayish", now)).toThrow(/could not read/);
        expect(() => parseSince("yesterdayish", now)).toThrow(/7d/);
    });

    it("rejects a bare number, suggesting the unit", () => {
        // Date.parse("7") succeeds, so without an explicit guard `--since 7` would silently mean
        // some arbitrary date rather than seven days.
        expect(() => parseSince("7", now)).toThrow(/no unit/);
        expect(() => parseSince("7", now)).toThrow(/7d/);
    });

    it("rejects an unknown unit", () => {
        expect(() => parseSince("7y", now)).toThrow();
    });
});

describe("formatDuration", () => {
    const seconds = (n: number) => n * 1000;
    const minutes = (n: number) => seconds(n * 60);
    const hours = (n: number) => minutes(n * 60);
    const days = (n: number) => hours(n * 24);

    it("uses seconds below a minute", () => {
        expect(formatDuration(0)).toBe("0s");
        expect(formatDuration(seconds(45))).toBe("45s");
    });

    it("uses minutes below an hour", () => {
        expect(formatDuration(minutes(7))).toBe("7m");
        expect(formatDuration(minutes(59))).toBe("59m");
    });

    it("uses hours below a day, with one decimal under ten", () => {
        expect(formatDuration(hours(1.5))).toBe("1.5h");
        expect(formatDuration(hours(23))).toBe("23h");
    });

    it("uses days beyond that", () => {
        expect(formatDuration(days(1.5))).toBe("1.5d");
        expect(formatDuration(days(12))).toBe("12d");
    });

    it("rounds rather than truncating", () => {
        expect(formatDuration(seconds(90))).toBe("2m");
    });
});
