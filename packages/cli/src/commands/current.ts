import type { CommandModule } from "yargs";
import { padId, resolveAuthor, stateCategory } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";

/**
 * `motte current` — what you have in hand.
 *
 * Built for the commit hook, which needs one machine-readable answer to "which issue is this commit for",
 * and useful on its own for the same reason a person asks it.
 *
 * Deliberately silent rather than chatty when the answer is not exactly one issue. Two claimed issues means
 * the hook cannot know which a commit belongs to, and guessing would put the wrong reference in permanent
 * history. Nothing on stdout, exit 0 — the caller carries on.
 */

interface CurrentArgs {
    json?: boolean;
}

export const currentCommand: CommandModule<{}, CurrentArgs> = {
    command: "current",
    describe: "The issue you have claimed and started, if there is exactly one",
    builder: (yargs) =>
        yargs.option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const author = resolveAuthor({ cwd: config.root });
        const name = author.name.toLowerCase();

        const held = store
            .all()
            .filter(
                (issue) =>
                    issue.assignee?.toLowerCase() === name &&
                    stateCategory(config, issue.state) === "started"
            );

        if (args.json === true) {
            emitJson({
                // Named `issues` rather than `issue`: the ambiguous case is real and a caller has to be
                // able to see it rather than receive a guess.
                count: held.length,
                issues: held.map((issue) => issueJson(issue))
            });
            return;
        }

        if (held.length !== 1) return;

        process.stdout.write(`#${padId(held[0]!.id)}\n`);
    }
};
