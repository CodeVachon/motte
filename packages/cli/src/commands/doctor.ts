import type { CommandModule } from "yargs";
import { buildTree, dependencyProblems, idFromFilename, stateCategory } from "@motte/core";
import { basename } from "node:path";
import { context, emitJson } from "../context.js";
import { dim, error, ok, warn } from "../ui/format.js";

interface Problem {
    severity: "error" | "warning";
    kind: string;
    message: string;
    file?: string | undefined;
}

interface DoctorArgs {
    json?: boolean;
}

export const doctorCommand: CommandModule<{}, DoctorArgs> = {
    command: "doctor",
    describe: "Validate the backlog and report every problem found",
    builder: (yargs) =>
        yargs.option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const problems: Problem[] = [];

        for (const broken of store.brokenFiles()) {
            problems.push({
                severity: "error",
                kind: "unparseable",
                message: broken.message,
                file: broken.filePath
            });
        }

        const issues = store.all();
        const { problems: treeProblems } = buildTree(issues);

        for (const problem of treeProblems) {
            problems.push({
                severity: "error",
                kind: problem.kind,
                message: problem.message,
                file: problem.issues[0]?.filePath
            });
        }

        for (const problem of dependencyProblems(config, issues)) {
            problems.push({
                // Working on something still blocked is the author's call, not a broken file.
                severity: problem.kind === "started-while-blocked" ? "warning" : "error",
                kind: problem.kind,
                message: problem.message,
                file: problem.issues[0]?.filePath
            });
        }

        for (const issue of issues) {
            if (stateCategory(config, issue.state) === undefined) {
                problems.push({
                    severity: "error",
                    kind: "unknown-state",
                    message:
                        `#${issue.id} has state "${issue.state}", which is not in the configured ` +
                        `states: ${config.states.map((state) => state.name).join(", ")}`,
                    file: issue.filePath
                });
            }

            // A filename whose id prefix disagrees with the frontmatter means a rename went wrong;
            // the frontmatter wins, but the mismatch will confuse anyone reading the directory.
            if (issue.filePath !== undefined) {
                const fromName = idFromFilename(basename(issue.filePath));
                if (fromName === undefined) {
                    problems.push({
                        severity: "warning",
                        kind: "filename",
                        message: `${basename(issue.filePath)} does not start with a zero-padded id`,
                        file: issue.filePath
                    });
                } else if (fromName !== issue.id) {
                    problems.push({
                        severity: "error",
                        kind: "filename",
                        message: `${basename(issue.filePath)} claims #${fromName} but its frontmatter says #${issue.id}`,
                        file: issue.filePath
                    });
                }
            }

            if (issue.description.trim().length === 0) {
                problems.push({
                    severity: "warning",
                    kind: "empty-description",
                    message: `#${issue.id} has no description`,
                    file: issue.filePath
                });
            }
        }

        const errors = problems.filter((problem) => problem.severity === "error");
        const warnings = problems.filter((problem) => problem.severity === "warning");

        if (args.json === true) {
            emitJson({
                ok: errors.length === 0,
                checked: issues.length,
                errors,
                warnings
            });
            if (errors.length > 0) process.exitCode = 1;
            return;
        }

        const out = process.stdout;

        for (const problem of errors) {
            out.write(`${error(problem.message)}\n`);
            if (problem.file !== undefined) out.write(`  ${dim(problem.file)}\n`);
        }

        for (const problem of warnings) {
            out.write(`${warn(problem.message)}\n`);
            if (problem.file !== undefined) out.write(`  ${dim(problem.file)}\n`);
        }

        if (errors.length === 0 && warnings.length === 0) {
            out.write(`${ok(`${issues.length} issues, no problems found`)}\n`);
        } else {
            out.write(
                `\n${dim(`${issues.length} issues checked · ${errors.length} error(s) · ${warnings.length} warning(s)`)}\n`
            );
        }

        if (errors.length > 0) process.exitCode = 1;
    }
};
