import { describe, expect, it } from "vitest";
import { chooseAgentTargets } from "./agentSelector.js";

const TARGETS = [
    { id: "claude-code", label: "Claude Code", detected: true },
    { id: "cursor", label: "Cursor", detected: false }
] as const;

describe("chooseAgentTargets", () => {
    it("offers every target and preselects only detected ones", async () => {
        let asked:
            | {
                  message: string;
                  options: { value: string; label: string; hint?: string }[];
                  initialValues: string[];
                  required: boolean;
              }
            | undefined;

        const selected = await chooseAgentTargets([...TARGETS], async (options) => {
            asked = options;
            return ["cursor"];
        });

        expect(selected).toEqual(["cursor"]);
        expect(asked).toEqual({
            message: "Select agent integrations to install",
            options: [
                { value: "claude-code", label: "Claude Code", hint: "detected" },
                { value: "cursor", label: "Cursor" }
            ],
            initialValues: ["claude-code"],
            required: false
        });
    });

    it("keeps cancellation distinct from deliberately choosing no integrations", async () => {
        expect(await chooseAgentTargets([...TARGETS], async () => [])).toEqual([]);
        expect(await chooseAgentTargets([...TARGETS], async () => Symbol("cancel"))).toBeNull();
    });
});
