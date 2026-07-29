import type { CommandModule } from "yargs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CONFIG_FILENAME, DEFAULT_STATES } from "@motte/core";
import { dim, ok, warn } from "../ui/format.js";

const SCHEMA_URL = "https://codevachon.github.io/motte/schema/config.json";

interface InitArgs {
    dir?: string;
    name?: string;
    force?: boolean;
}

export const initCommand: CommandModule<{}, InitArgs> = {
    command: "init [dir]",
    describe: `Create ${CONFIG_FILENAME} and the issues directory`,
    builder: (yargs) =>
        yargs
            .positional("dir", { type: "string", describe: "Project directory (defaults to cwd)" })
            .option("name", { type: "string", describe: "Project name" })
            .option("force", { type: "boolean", describe: "Overwrite an existing config" }),
    handler: (args) => {
        const root = resolve(args.dir ?? process.cwd());
        const configPath = join(root, CONFIG_FILENAME);

        if (existsSync(configPath) && args.force !== true) {
            process.stderr.write(
                `${warn(`${configPath} already exists. Pass --force to overwrite it.`)}\n`
            );
            process.exitCode = 1;
            return;
        }

        const issuesDir = ".motte/issues";
        const config = {
            $schema: SCHEMA_URL,
            name: args.name ?? basename(root),
            issuesDir,
            defaultState: DEFAULT_STATES[0]!.name,
            states: DEFAULT_STATES
        };

        mkdirSync(join(root, issuesDir), { recursive: true });
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

        const out = process.stdout;
        out.write(`${ok(`wrote ${CONFIG_FILENAME}`)}\n`);
        out.write(`${ok(`created ${issuesDir}/`)}\n`);
        out.write(
            `\n${dim("Commit both — the backlog is meant to travel with the code.")}\n` +
                `${dim('Next: `motte add "your first issue"`, then `motte install` to wire up your agents.')}\n`
        );
    }
};
