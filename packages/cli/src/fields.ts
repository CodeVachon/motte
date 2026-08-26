import { parseIssueFieldValue, type Config, type IssueFieldValue } from "@motte/core";

/**
 * Turn repeatable `--field key=value` arguments into the project's typed field map.
 *
 * Empty values deliberately mean "clear" for mutations. Queries reject them because an absent
 * field and an empty text field are different things and a filter must not blur that distinction.
 */
export function parseFieldArguments(
    config: Config,
    values: readonly string[] | undefined
): Record<string, IssueFieldValue> | undefined;
export function parseFieldArguments(
    config: Config,
    values: readonly string[] | undefined,
    options: { allowClear: true }
): Record<string, IssueFieldValue | null> | undefined;
export function parseFieldArguments(
    config: Config,
    values: readonly string[] | undefined,
    options: { allowClear?: boolean } = {}
): Record<string, IssueFieldValue | null> | undefined {
    if (values === undefined || values.length === 0) return undefined;

    const declarations = new Map((config.issueFields ?? []).map((field) => [field.key, field]));
    const fields: Record<string, IssueFieldValue | null> = {};

    for (const entry of values) {
        const separator = entry.indexOf("=");
        if (separator <= 0) {
            throw new Error(`invalid --field ${JSON.stringify(entry)}; use --field key=value`);
        }

        const key = entry.slice(0, separator);
        const value = entry.slice(separator + 1);
        const declaration = declarations.get(key);
        if (declaration === undefined) {
            throw new Error(`unknown issue field "${key}"`);
        }
        if (value.length === 0) {
            if (options.allowClear !== true) {
                throw new Error(`--field ${key}= cannot be empty here`);
            }
            fields[key] = null;
            continue;
        }
        fields[key] = parseIssueFieldValue(declaration, value);
    }

    return fields;
}
