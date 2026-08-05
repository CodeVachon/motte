import chalk from "chalk";
import {
    padId,
    progressBar,
    type Config,
    type Issue,
    type Progress,
    type StateCategory,
    type TreeNode
} from "@motte/core";

const CATEGORY_COLOR: Record<StateCategory, (text: string) => string> = {
    unstarted: chalk.gray,
    started: chalk.yellow,
    completed: chalk.green,
    cancelled: chalk.dim.strikethrough
};

export function paintState(config: Config, stateName: string): string {
    const state = config.states.find((candidate) => candidate.name === stateName);
    if (!state) return chalk.bgRed.white(` ${stateName} `);
    return CATEGORY_COLOR[state.category](stateName);
}

export function paintId(id: number): string {
    return chalk.cyan(`#${padId(id)}`);
}

/** Longest state name in the config, so state columns line up. */
function stateWidth(config: Config): number {
    return Math.max(...config.states.map((state) => state.name.length));
}

export function issueLine(config: Config, issue: Issue, indent = 0): string {
    const state = paintState(config, issue.state);
    const padding = " ".repeat(Math.max(0, stateWidth(config) - issue.state.length));
    const prefix = "  ".repeat(indent);

    const trailing: string[] = [];
    if (issue.assignee !== undefined) trailing.push(chalk.magenta(`@${issue.assignee}`));
    if (issue.labels !== undefined && issue.labels.length > 0) {
        trailing.push(chalk.blue(issue.labels.map((label) => `+${label}`).join(" ")));
    }
    if (issue.notes.length > 0) trailing.push(chalk.dim(`${issue.notes.length}n`));

    return [
        paintId(issue.id),
        `${state}${padding}`,
        `${prefix}${issue.title}`,
        trailing.length > 0 ? chalk.dim("·") : "",
        ...trailing
    ]
        .filter((part) => part.length > 0)
        .join(" ");
}

export function treeLines(config: Config, nodes: TreeNode[]): string[] {
    return nodes.map((node) => issueLine(config, node.issue, node.depth));
}

export function progressLine(progress: Progress): string {
    const bar = progressBar(progress.percentComplete);
    const counts = [
        chalk.green(`${progress.completed} done`),
        chalk.yellow(`${progress.started} started`),
        chalk.gray(`${progress.unstarted} todo`)
    ];
    if (progress.cancelled > 0) counts.push(chalk.dim(`${progress.cancelled} cancelled`));

    return `${chalk.green(bar)} ${chalk.bold(`${progress.percentComplete}%`)}  ${counts.join(chalk.dim(" · "))}`;
}

export function heading(text: string): string {
    return chalk.bold.underline(text);
}

export function dim(text: string): string {
    return chalk.dim(text);
}

/** Used to pick a search match out of the line it was found on. */
export function bold(text: string): string {
    return chalk.bold(text);
}

export function warn(text: string): string {
    return chalk.yellow(`! ${text}`);
}

export function error(text: string): string {
    return chalk.red(`✗ ${text}`);
}

export function ok(text: string): string {
    return chalk.green(`✓ ${text}`);
}
