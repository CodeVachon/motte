import { describe, expect, it } from "vitest";
import type { Config, IssueRef, State } from "@motte/core";
import {
    candidateStyle,
    completionCandidates,
    expectedAt,
    formatCandidates,
    isZshShell,
    wordsFromArgv,
    type CompletionSource
} from "./completion.js";

const STATES: State[] = [
    { name: "Todo", category: "unstarted" },
    { name: "In Progress", category: "started" },
    { name: "Done", category: "completed" }
];

const config: Config = {
    name: "test",
    issuesDir: ".motte/issues",
    states: STATES,
    defaultState: "Todo",
    root: "/tmp/test",
    configPath: "/tmp/test/.motte.config.json",
    issuesPath: "/tmp/test/.motte/issues",
    events: { enabled: false }
};

function ref(id: number, title: string, extra: Partial<IssueRef> = {}): IssueRef {
    return {
        id,
        title,
        state: "Todo",
        created: "2026-07-29T12:00:00Z",
        updated: "2026-07-29T12:00:00Z",
        filePath: `/tmp/test/.motte/issues/${String(id).padStart(4, "0")}-x.md`,
        ...extra
    };
}

const source: CompletionSource = {
    config,
    refs: [
        ref(1, "Build a login page", { labels: ["ui"], assignee: "chris" }),
        ref(2, "Wire up the API", { labels: ["api"], assignee: "atlas", state: "In Progress" }),
        ref(7, "Frontmatter-only reader for latency-sensitive reads", { blockedBy: [1, 2] })
    ]
};

const values = (candidates: ReturnType<typeof completionCandidates>) =>
    (candidates ?? []).map((candidate) => candidate.value);

describe("expectedAt", () => {
    it("knows the first positional of show is a ref", () => {
        expect(expectedAt(["show"])).toBe("ref");
    });

    it("knows move takes a ref then a state", () => {
        expect(expectedAt(["move"])).toBe("ref");
        expect(expectedAt(["move", "7"])).toBe("state");
    });

    it("knows assign takes a ref then an assignee", () => {
        expect(expectedAt(["assign", "7"])).toBe("assignee");
    });

    it("returns null past the last positional", () => {
        expect(expectedAt(["move", "7", "done"])).toBeNull();
    });

    it("returns null before a command is typed", () => {
        expect(expectedAt([])).toBeNull();
    });

    it("returns null for a command with no dynamic positionals", () => {
        expect(expectedAt(["status"])).toBeNull();
        expect(expectedAt(["init"])).toBeNull();
    });

    it("reads the expectation from a preceding flag", () => {
        expect(expectedAt(["add", "Title", "--state"])).toBe("state");
        expect(expectedAt(["add", "Title", "-p"])).toBe("ref");
        expect(expectedAt(["list", "--label"])).toBe("label");
    });

    it("does not count a flag's value as a positional", () => {
        // `--state todo` must not shift `move`'s positional index.
        expect(expectedAt(["move", "--state", "todo"])).toBe("ref");
    });

    it("does not count a boolean flag as a positional", () => {
        // A boolean consumes no value, so the position after it is still a positional.
        expect(expectedAt(["move", "--json"])).toBe("ref");
        expect(expectedAt(["move", "7", "--json"])).toBe("state");
    });

    it("offers nothing after a value-taking flag it has no candidates for", () => {
        // `--description` takes free text. Offering issue refs there would be wrong.
        expect(expectedAt(["edit", "7", "--description"])).toBeNull();
    });

    it("does not let a free-text flag value shift the positional index", () => {
        expect(expectedAt(["move", "--description", "some text"])).toBe("ref");
    });

    it("ignores a leading flag before the command", () => {
        expect(expectedAt(["--json", "show"])).toBe("ref");
    });
});

describe("issue refs", () => {
    it("completes to ids for an empty prefix, with titles as descriptions", () => {
        const candidates = completionCandidates(source, ["show"], "")!;

        expect(candidates.map((c) => c.value)).toEqual(["1", "2", "7"]);
        expect(candidates[0]!.description).toBe("Build a login page [Todo]");
    });

    it("completes to ids for a numeric prefix", () => {
        expect(values(completionCandidates(source, ["show"], "7"))).toEqual(["1", "2", "7"]);
    });

    it("completes to slugs for an alphabetic prefix", () => {
        const candidates = completionCandidates(source, ["show"], "fr")!;

        // Slugs contain no spaces, so the shell needs no quoting — and `resolve` matches slug
        // forms precisely so that these values work when inserted.
        expect(candidates.map((c) => c.value)).toContain(
            "frontmatter-only-reader-for-latency-sensitive-reads"
        );
        expect(candidates.every((c) => !c.value.includes(" "))).toBe(true);
    });

    it("describes a slug candidate with its id and state", () => {
        const candidates = completionCandidates(source, ["show"], "build")!;
        const login = candidates.find((c) => c.value === "build-a-login-page")!;

        expect(login.description).toBe("#0001 [Todo]");
    });
});

describe("states", () => {
    it("completes state names with their category", () => {
        const candidates = completionCandidates(source, ["move", "7"], "")!;

        expect(candidates.map((c) => c.value)).toEqual(["Todo", "In Progress", "Done"]);
        expect(candidates[1]!.description).toBe("started");
    });

    it("completes a state after --state", () => {
        expect(values(completionCandidates(source, ["add", "T", "--state"], ""))).toContain("Done");
    });
});

describe("assignees", () => {
    it("offers assignees seen in the backlog, plus none", () => {
        expect(values(completionCandidates(source, ["assign", "7"], ""))).toEqual([
            "atlas",
            "chris",
            "none"
        ]);
    });

    it("de-duplicates and sorts", () => {
        const many: CompletionSource = {
            config,
            refs: [ref(1, "A", { assignee: "zoe" }), ref(2, "B", { assignee: "zoe" })]
        };

        expect(values(completionCandidates(many, ["assign", "1"], ""))).toEqual(["zoe", "none"]);
    });
});

describe("labels", () => {
    it("offers labels seen in the backlog, sorted and de-duplicated", () => {
        expect(values(completionCandidates(source, ["list", "--label"], ""))).toEqual([
            "api",
            "ui"
        ]);
    });
});

describe("unblock", () => {
    it("offers only the blockers the target actually has", () => {
        const candidates = completionCandidates(source, ["unblock", "7"], "")!;

        // #7 is blocked by 1 and 2; offering anything else would be a no-op.
        expect(candidates.map((c) => c.value)).toEqual(["1", "2"]);
        expect(candidates[0]!.description).toBe("Build a login page");
    });

    it("offers nothing when the target has no blockers", () => {
        expect(completionCandidates(source, ["unblock", "1"], "")).toEqual([]);
    });

    it("resolves the target by slug as well as by id", () => {
        expect(values(completionCandidates(source, ["unblock", "frontmatter-only"], ""))).toEqual([
            "1",
            "2"
        ]);
    });

    it("offers nothing for an unknown target rather than throwing", () => {
        expect(completionCandidates(source, ["unblock", "nonexistent"], "")).toEqual([]);
    });

    it("labels a missing blocker rather than omitting it", () => {
        const dangling: CompletionSource = {
            config,
            refs: [ref(1, "Dangling", { blockedBy: [99] })]
        };

        expect(completionCandidates(dangling, ["unblock", "1"], "")).toEqual([
            { value: "99", description: "missing" }
        ]);
    });
});

describe("deferring to yargs", () => {
    it("returns undefined for a partial flag", () => {
        expect(completionCandidates(source, ["show"], "--js")).toBeUndefined();
    });

    it("returns undefined when no command has been typed", () => {
        expect(completionCandidates(source, [], "sh")).toBeUndefined();
    });

    it("returns undefined for a command with no dynamic values", () => {
        expect(completionCandidates(source, ["status"], "")).toBeUndefined();
    });
});

describe("formatCandidates", () => {
    it("emits bare values for bash, which shows no descriptions", () => {
        expect(formatCandidates([{ value: "7", description: "A title" }], "plain")).toEqual(["7"]);
    });

    describe("zsh", () => {
        it("emits value:description, which is what _describe reads", () => {
            expect(formatCandidates([{ value: "7", description: "A title" }], "zsh")).toEqual([
                "7:A title"
            ]);
        });

        it("omits the separator when there is no description", () => {
            expect(formatCandidates([{ value: "7" }], "zsh")).toEqual(["7"]);
        });

        it("escapes a colon in the value, since zsh reads it as the separator", () => {
            expect(formatCandidates([{ value: "a:b", description: "d" }], "zsh")).toEqual([
                "a\\:b:d"
            ]);
        });

        it("strips colons out of the description so it cannot be misread", () => {
            expect(formatCandidates([{ value: "7", description: "a: b" }], "zsh")).toEqual([
                "7:a b"
            ]);
        });

        it("collapses newlines in a description onto one line", () => {
            expect(formatCandidates([{ value: "7", description: "a\nb" }], "zsh")).toEqual([
                "7:a b"
            ]);
        });
    });

    describe("fish and PowerShell", () => {
        it("separates the description with a tab", () => {
            expect(formatCandidates([{ value: "7", description: "A title" }], "tab")).toEqual([
                "7\tA title"
            ]);
        });

        /** A colon is ordinary text here — only zsh reads it as a separator. */
        it("leaves colons alone in both halves", () => {
            expect(formatCandidates([{ value: "a:b", description: "c: d" }], "tab")).toEqual([
                "a:b\tc: d"
            ]);
        });

        it("emits the value alone when there is no description", () => {
            expect(formatCandidates([{ value: "7" }], "tab")).toEqual(["7"]);
        });

        /** A label named `type:bug` was offered to fish as `type\:bug` until this was pinned down. */
        it("does not escape a colon in a value that has no description", () => {
            expect(formatCandidates([{ value: "type:bug" }], "tab")).toEqual(["type:bug"]);
            // zsh still needs it, since that is where the colon means something.
            expect(formatCandidates([{ value: "type:bug" }], "zsh")).toEqual(["type\\:bug"]);
        });

        /** A tab inside a description would look like a second field, so newlines and tabs collapse. */
        it("collapses whitespace so one candidate stays one field pair", () => {
            expect(formatCandidates([{ value: "7", description: "a\tb\nc" }], "tab")).toEqual([
                "7\ta b c"
            ]);
        });
    });
});

describe("candidateStyle", () => {
    /**
     * fish and PowerShell announce themselves, because there is nothing to sniff: fish only sets `SHELL`
     * for a login shell and PowerShell does not set it at all.
     */
    it("believes what the script declares", () => {
        expect(candidateStyle({ MOTTE_COMPLETION_SHELL: "fish" })).toBe("tab");
        expect(candidateStyle({ MOTTE_COMPLETION_SHELL: "powershell" })).toBe("tab");
        expect(candidateStyle({ MOTTE_COMPLETION_SHELL: "zsh" })).toBe("zsh");
        expect(candidateStyle({ MOTTE_COMPLETION_SHELL: "bash" })).toBe("plain");
    });

    it("falls back to sniffing for the yargs-generated scripts", () => {
        expect(candidateStyle({ SHELL: "/bin/zsh" })).toBe("zsh");
        expect(candidateStyle({ ZSH_NAME: "zsh" })).toBe("zsh");
        expect(candidateStyle({ SHELL: "/bin/bash" })).toBe("plain");
        expect(candidateStyle({})).toBe("plain");
    });

    it("ignores a declaration it does not recognise rather than guessing", () => {
        expect(candidateStyle({ MOTTE_COMPLETION_SHELL: "nushell", SHELL: "/bin/zsh" })).toBe(
            "zsh"
        );
    });
});

describe("wordsFromArgv", () => {
    /** What the shell scripts actually invoke: <runtime> <script> --get-yargs-completions <words...> */
    const argv = (...words: string[]) => ["/usr/bin/motte", "--get-yargs-completions", ...words];

    it("drops the runtime, the flag, and the program name", () => {
        expect(wordsFromArgv(argv("motte", "show", "7"), "7")).toEqual(["show"]);
    });

    it("drops the partial word being completed", () => {
        expect(wordsFromArgv(argv("motte", "move", "7", ""), "")).toEqual(["move", "7"]);
    });

    it("keeps a partial word that is not the last argument", () => {
        expect(wordsFromArgv(argv("motte", "move", "7"), "")).toEqual(["move", "7"]);
    });

    /**
     * The reason this reads process.argv rather than the parsed argv: yargs consumes flags, so
     * `--label` would be gone and a flag-value position would be indistinguishable from a positional.
     */
    it("preserves flags, which the parsed argv would have consumed", () => {
        expect(wordsFromArgv(argv("motte", "list", "--label", ""), "")).toEqual([
            "list",
            "--label"
        ]);
        expect(expectedAt(wordsFromArgv(argv("motte", "list", "--label", ""), ""))).toBe("label");
    });

    it("preserves a flag and its value together", () => {
        expect(wordsFromArgv(argv("motte", "add", "T", "--state", "Todo", ""), "")).toEqual([
            "add",
            "T",
            "--state",
            "Todo"
        ]);
    });

    it("returns nothing when the completion flag is absent", () => {
        expect(wordsFromArgv(["/usr/bin/motte", "status"], "")).toEqual([]);
    });

    it("returns nothing for a bare invocation with only the program name", () => {
        expect(wordsFromArgv(argv("motte"), "motte")).toEqual([]);
    });

    it("round-trips the cases the shell actually sends", () => {
        // `motte show <TAB>` — expects issue refs.
        expect(expectedAt(wordsFromArgv(argv("motte", "show", ""), ""))).toBe("ref");
        // `motte move 7 <TAB>` — expects a state.
        expect(expectedAt(wordsFromArgv(argv("motte", "move", "7", ""), ""))).toBe("state");
        // `motte assign 7 <TAB>` — expects an assignee.
        expect(expectedAt(wordsFromArgv(argv("motte", "assign", "7", ""), ""))).toBe("assignee");
        // `motte unblock 28 <TAB>` — expects one of that issue's blockers.
        expect(expectedAt(wordsFromArgv(argv("motte", "unblock", "28", ""), ""))).toBe(
            "blocker-of-previous"
        );
        // `motte <TAB>` — nothing dynamic; yargs completes command names.
        expect(expectedAt(wordsFromArgv(argv("motte", ""), ""))).toBeNull();
    });
});

describe("isZshShell", () => {
    it("detects zsh from SHELL", () => {
        expect(isZshShell({ SHELL: "/bin/zsh" })).toBe(true);
        expect(isZshShell({ SHELL: "/bin/bash" })).toBe(false);
    });

    it("detects zsh from ZSH_NAME", () => {
        expect(isZshShell({ ZSH_NAME: "zsh" })).toBe(true);
    });

    it("assumes not zsh when neither is set", () => {
        expect(isZshShell({})).toBe(false);
    });
});
