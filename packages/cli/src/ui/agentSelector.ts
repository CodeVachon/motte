import { isCancel, multiselect } from "@clack/prompts";
import type { AgentId } from "../install/record.js";
import type { AgentTarget } from "../install/wiring.js";

interface AgentChoice {
    value: AgentId;
    label: string;
    hint?: string;
}

interface PromptOptions {
    message: string;
    options: AgentChoice[];
    initialValues: AgentId[];
    required: boolean;
}

type Select = (options: PromptOptions) => Promise<AgentId[] | symbol>;

async function select(options: PromptOptions): Promise<AgentId[] | symbol> {
    return multiselect(options);
}

/**
 * Ask which detected and supported agent integrations belong in a new project.
 *
 * `null` means the person cancelled. An empty array is a deliberate choice to write only AGENTS.md.
 * Keeping those outcomes distinct stops Ctrl-C from looking like consent to change the project file.
 */
export async function chooseAgentTargets(
    targets: AgentTarget[],
    prompt: Select = select
): Promise<AgentId[] | null> {
    const answer = await prompt({
        message: "Select agent integrations to install",
        options: targets.map((target) => ({
            value: target.id,
            label: target.label,
            ...(target.detected ? { hint: "detected" } : {})
        })),
        initialValues: targets.filter((target) => target.detected).map((target) => target.id),
        required: false
    });

    return isCancel(answer) || !Array.isArray(answer) ? null : answer;
}
