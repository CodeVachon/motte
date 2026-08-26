import { isCancel, text } from "@clack/prompts";
import { parseIssueFieldValue, type IssueFieldValue } from "@motte/core";
import type { IssueField } from "@motte/core";

function isInteractive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Ask for configured fields only in a real terminal; scripts use `--field key=value` instead. */
export async function promptIssueFields(
    declarations: readonly IssueField[]
): Promise<Record<string, IssueFieldValue> | null | undefined> {
    if (!isInteractive() || declarations.length === 0) return undefined;

    const fields: Record<string, IssueFieldValue> = {};
    for (const field of declarations) {
        const answer = await text({
            message: `${field.key}: ${field.description}`,
            placeholder: field.isRequired ? `${field.type} (required)` : `${field.type} (optional)`,
            validate(value) {
                const textValue = value ?? "";
                if (textValue.length === 0 && !field.isRequired) return undefined;
                try {
                    parseIssueFieldValue(field, textValue);
                    return undefined;
                } catch (error) {
                    return error instanceof Error ? error.message : String(error);
                }
            }
        });
        if (isCancel(answer) || typeof answer !== "string") return null;
        if (answer.length > 0) fields[field.key] = parseIssueFieldValue(field, answer);
    }

    return fields;
}
