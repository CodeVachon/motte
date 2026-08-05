import type { CommandModule } from "yargs";
import { rankReady, resolveAuthor, type Ranked } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, issueLine } from "../ui/format.js";

/**
 * `motte next` — what to pick up.
 *
 * `motte ready` answers "what could be started", in id order, which means an agent facing fifteen ready
 * issues takes the lowest number. This answers "what should be started", and says why.
 *
 * The caller's identity is resolved the same way a note's author is, so `next` means "next for me" without
 * anybody having to pass a name: an issue with somebody else's name on it is not offered.
 */

interface NextArgs {
    limit?: number;
    mine?: boolean;
    why?: boolean;
    json?: boolean;
}

export const nextCommand: CommandModule<{}, NextArgs> = {
    command: "next",
    describe: "The issue to pick up next, and why",
    builder: (yargs) =>
        yargs
            .option("limit", {
                alias: "n",
                type: "number",
                default: 1,
                describe: "How many to show"
            })
            .option("mine", { type: "boolean", describe: "Only work already assigned to me" })
            .option("why", { type: "boolean", describe: "Explain the ordering" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const issues = store.all();

        const author = resolveAuthor({ cwd: config.root });
        const ranked = rankReady(config, issues, {
            assignee: author.name,
            mineOnly: args.mine === true
        });

        const limit = Math.max(1, args.limit ?? 1);
        const shown = ranked.slice(0, limit);

        if (args.json === true) {
            emitJson({
                count: ranked.length,
                issues: shown.map((entry) => ({
                    ...issueJson(entry.issue),
                    // The signals as well as the prose: an agent can act on the numbers, and a person can
                    // read the sentence.
                    why: entry.reasons,
                    signals: entry.signals
                }))
            });
            return;
        }

        if (shown.length === 0) {
            process.stdout.write(`${dim(nothingReason(args.mine === true))}\n`);
            return;
        }

        const out = process.stdout;

        for (const entry of shown) {
            out.write(`${issueLine(config, entry.issue)}\n`);

            if (args.why === true) {
                for (const reason of reasonsWith(entry, ranked)) {
                    out.write(`      ${dim(reason)}\n`);
                }
            }
        }

        if (ranked.length > shown.length) {
            out.write(`\n${dim(`${ranked.length - shown.length} more ready`)}\n`);
        }
    }
};

/**
 * The reasons, plus the one that only makes sense relative to the rest of the set.
 *
 * "Oldest" is a fact about the whole ready set rather than about one issue, so core does not claim it and
 * this adds it where it is true.
 */
function reasonsWith(entry: Ranked, all: Ranked[]): string[] {
    const reasons = [...entry.reasons];

    // Strictly oldest, not merely equal-oldest. A batch of issues filed in the same second is common —
    // `breakdown` creates several at once — and telling the reader that three of them are each the longest
    // waiting is noise dressed as a reason.
    const oldest = all.every(
        (other) =>
            other.issue.id === entry.issue.id ||
            other.issue.created.localeCompare(entry.issue.created) > 0
    );
    if (oldest && all.length > 1) reasons.push("longest waiting");

    // Something always has to be said, or `--why` prints an issue and nothing under it.
    if (reasons.length === 0) reasons.push("nothing else ranks above it");

    return reasons;
}

function nothingReason(mineOnly: boolean): string {
    return mineOnly
        ? "nothing assigned to you is ready"
        : "nothing is ready — `motte ready --blocked` shows what is waiting, and on what";
}
