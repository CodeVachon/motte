import { describe, expect, it } from "vitest";
import { TextArgError, textArg } from "./textArg.js";

/**
 * Free text that might begin with a dash.
 *
 * The stdin half needs a process of its own and is tested in `mutate.test.ts` against a real spawn. What
 * is checked here is the argument arithmetic: which of two possible sources wins, and what happens when
 * both or neither is present.
 */

const NOTE = { what: "note body", usage: "motte note 42" };

describe("textArg", () => {
    it("takes the positional when yargs filled it", () => {
        expect(textArg({ ...NOTE, value: "ordinary text", argv: ["note"] })).toBe("ordinary text");
    });

    /** The whole point: `--` protects the text, and yargs leaves it in `_` rather than the positional. */
    it("takes what followed `--` when the positional is empty", () => {
        expect(textArg({ ...NOTE, value: undefined, argv: ["note", "--fix repairs three"] })).toBe(
            "--fix repairs three"
        );
    });

    /** An unquoted sentence after `--` arrives already split by the shell. */
    it("rejoins several tokens after `--`", () => {
        expect(
            textArg({ ...NOTE, value: undefined, argv: ["note", "--fix", "repairs", "three"] })
        ).toBe("--fix repairs three");
    });

    /**
     * Rather than picking one and dropping the other. Silently discarding text somebody typed is worse
     * than making them say it again.
     */
    it("refuses text given both ways, naming both", () => {
        try {
            textArg({ ...NOTE, value: "one", argv: ["note", "two"] });
            expect.unreachable("should have thrown");
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(TextArgError);
            expect((thrown as Error).message).toContain('"one"');
            expect((thrown as Error).message).toContain('"two"');
        }
    });

    it("treats an empty positional as nothing given", () => {
        expect(() => textArg({ ...NOTE, value: "", argv: ["note"] })).toThrow(TextArgError);
    });

    describe("when nothing was given", () => {
        it("says what it wanted and how to escape a dash", () => {
            try {
                textArg({ ...NOTE, value: undefined, argv: ["note"] });
                expect.unreachable("should have thrown");
            } catch (thrown) {
                const message = (thrown as Error).message;
                expect(message).toContain("no note body given");
                expect(message).toContain('motte note 42 "the text"');
                expect(message).toContain("motte note 42 -- ");
            }
        });

        /**
         * `add` does not read a title from stdin, so its error must not offer it.
         *
         * The other half — that the message *does* offer stdin where it works — is asserted in
         * `mutate.test.ts`, against a real process. Nothing here may touch fd 0: in a vitest worker that
         * is the runner's own stdin.
         */
        it("does not offer stdin where it is not an option", () => {
            const title = (): void => {
                textArg({ what: "title", usage: "motte add", value: undefined, argv: ["add"] });
            };

            expect(title).toThrow(TextArgError);
            expect(title).not.toThrow(/< file\.md/);
        });
    });
});
