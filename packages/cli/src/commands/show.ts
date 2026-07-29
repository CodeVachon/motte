import type { CommandModule } from "yargs";
import { subtreeReport } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, heading, issueLine, paintId, paintState, progressLine } from "../ui/format.js";

interface ShowArgs {
    ref: string;
    json?: boolean;
}

export const showCommand: CommandModule<{}, ShowArgs> = {
    command: "show <ref>",
    describe: "Show one issue in full",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "Issue number or part of its title"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const issue = store.resolve(args.ref);
        const children = store.children(issue.id);

        if (args.json === true) {
            emitJson({
                ...issueJson(issue),
                children: children.map((child) => issueJson(child)),
                progress:
                    children.length === 0 ? null : subtreeReport(config, store.all(), issue.id)
            });
            return;
        }

        const out = process.stdout;

        out.write(`\n${paintId(issue.id)} ${heading(issue.title)}\n`);

        const meta = [paintState(config, issue.state)];
        if (issue.parent !== undefined) meta.push(dim(`parent ${paintId(issue.parent)}`));
        if (issue.assignee !== undefined) meta.push(`@${issue.assignee}`);
        if (issue.labels !== undefined && issue.labels.length > 0) {
            meta.push(issue.labels.map((label) => `+${label}`).join(" "));
        }
        out.write(`${meta.join(dim("  ·  "))}\n`);
        out.write(`${dim(`created ${issue.created}   updated ${issue.updated}`)}\n`);

        if (issue.description.length > 0) {
            out.write(`\n${heading("Description")}\n\n${issue.description}\n`);
        }

        if (issue.plan.length > 0) {
            out.write(`\n${heading("Plan")}\n\n${issue.plan}\n`);
        }

        for (const section of issue.unknownSections) {
            if (section.heading === "") continue;
            out.write(`\n${heading(section.heading)}\n\n${section.body}\n`);
        }

        if (children.length > 0) {
            const report = subtreeReport(config, store.all(), issue.id);
            out.write(`\n${heading(`Children (${children.length})`)}\n\n`);
            for (const child of children) out.write(`${issueLine(config, child)}\n`);
            out.write(`\n${progressLine(report)}\n`);
        }

        if (issue.notes.length > 0) {
            out.write(`\n${heading(`Notes (${issue.notes.length})`)}\n`);
            for (const note of issue.notes) {
                const badge = note.author.type === "agent" ? "agent" : "user";
                out.write(`\n${dim(`${note.at}  ${note.author.name} (${badge})`)}\n${note.body}\n`);
            }
        }

        out.write(`\n${dim(issue.filePath ?? "")}\n`);
    }
};
