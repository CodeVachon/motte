import { useEffect, useState } from "react";
import { api, type ConfigResponse, type IssueResponse } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { categoryColour, type Backlog } from "../lib/useBacklog.js";
import { href, navigate } from "../lib/router.js";

/**
 * One issue, editable.
 *
 * Every field saves on blur rather than through a Save button. There is no draft state to lose — the file on
 * disk is the document, and a half-finished edit sitting in a browser tab that the CLI cannot see would be a
 * worse failure than a save the user did not explicitly ask for.
 *
 * Notes are append-only here as everywhere: the composer adds one, and there is no way to edit or remove an
 * existing note, because the record is meant to be a record.
 */

/** A text field that saves what changed, and only if it changed. */
function EditableText({
    label,
    value,
    multiline,
    onSave,
    testId
}: {
    label: string;
    value: string;
    multiline?: boolean;
    onSave: (next: string) => Promise<boolean>;
    testId: string;
}) {
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);

    // A change from elsewhere — the CLI, an agent — should win over an untouched draft. Comparing against
    // the incoming value means typing is not interrupted, but an idle field stays current.
    useEffect(() => {
        setDraft(value);
    }, [value]);

    async function commit(): Promise<void> {
        if (draft === value) return;

        setSaving(true);
        const ok = await onSave(draft);
        setSaving(false);
        // A refused write leaves the field showing what the user typed, with the reason above.
        if (!ok) return;
    }

    const shared = cn(
        "w-full rounded-lg border border-border bg-card p-3 text-sm",
        "focus:border-ring focus:outline-none",
        saving && "opacity-60"
    );

    return (
        <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                {label}
            </span>
            {multiline === true ? (
                <textarea
                    value={draft}
                    rows={Math.max(3, draft.split("\n").length + 1)}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commit()}
                    data-testid={testId}
                    className={cn(shared, "resize-y font-mono leading-relaxed")}
                />
            ) : (
                <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commit()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    data-testid={testId}
                    className={shared}
                />
            )}
        </label>
    );
}

function NoteComposer({ onAdd }: { onAdd: (body: string) => Promise<boolean> }) {
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);

    async function submit(): Promise<void> {
        if (body.trim() === "") return;

        setBusy(true);
        const ok = await onAdd(body);
        setBusy(false);
        // Only clear on success, so a refused note is not silently lost.
        if (ok) setBody("");
    }

    return (
        <div>
            <textarea
                value={body}
                rows={3}
                placeholder="What did you decide, and why?"
                onChange={(event) => setBody(event.target.value)}
                data-testid="note-body"
                className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:border-ring focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-3">
                <button
                    type="button"
                    disabled={busy || body.trim() === ""}
                    onClick={() => void submit()}
                    data-testid="add-note"
                    className={cn(
                        "rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground",
                        "disabled:opacity-40"
                    )}
                >
                    Add note
                </button>
                <span className="text-xs text-muted-foreground">
                    Notes are appended and never edited.
                </span>
            </div>
        </div>
    );
}

/** State, assignee and parent: the three fields that are pickers rather than prose. */
function Fields({
    issue,
    config,
    parents,
    mutate
}: {
    issue: IssueResponse;
    config: ConfigResponse;
    parents: IssueResponse[];
    mutate: Backlog["mutate"];
}) {
    const category = config.states.find((state) => state.name === issue.state)?.category ?? "";

    return (
        <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                    State
                </span>
                <div className="flex items-center gap-2">
                    <span
                        className={cn("size-2 shrink-0 rounded-full", categoryColour(category))}
                    />
                    <select
                        value={issue.state}
                        onChange={(event) =>
                            void mutate(() => api.update(issue.id, { state: event.target.value }))
                        }
                        data-testid="edit-state"
                        className="w-full rounded-lg border border-border bg-card p-2 text-sm focus:border-ring focus:outline-none"
                    >
                        {config.states.map((state) => (
                            <option key={state.name} value={state.name}>
                                {state.name}
                            </option>
                        ))}
                    </select>
                </div>
            </label>

            <EditableText
                label="Assignee"
                value={issue.assignee ?? ""}
                testId="edit-assignee"
                onSave={(next) =>
                    // Empty means unassigned, and `null` is how the API is told to clear a field.
                    mutate(() =>
                        api.update(issue.id, {
                            assignee: next.trim() === "" ? null : next.trim()
                        })
                    )
                }
            />

            <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                    Parent
                </span>
                <select
                    value={issue.parent === null ? "" : String(issue.parent)}
                    onChange={(event) =>
                        void mutate(() =>
                            api.update(issue.id, {
                                parent:
                                    event.target.value === "" ? null : Number(event.target.value)
                            })
                        )
                    }
                    data-testid="edit-parent"
                    className="w-full rounded-lg border border-border bg-card p-2 text-sm focus:border-ring focus:outline-none"
                >
                    <option value="">— none —</option>
                    {parents.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                            #{candidate.id} {candidate.title}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
}

/** The note trail, and the composer that appends to it. */
function Notes({ issue, mutate }: { issue: IssueResponse; mutate: Backlog["mutate"] }) {
    return (
        <section>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Notes ({issue.notes.length})
            </h2>
            <ul className="mb-4 flex flex-col gap-3" data-testid="notes">
                {issue.notes.map((note, index) => (
                    <li
                        key={`${note.at}-${index}`}
                        className="rounded-lg border border-border bg-card p-3"
                    >
                        <div className="mb-1 text-xs text-muted-foreground">
                            {note.at.replace("T", " ").replace("Z", "")} — {note.author.name} (
                            {note.author.type})
                        </div>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {note.body}
                        </div>
                    </li>
                ))}
                {issue.notes.length === 0 && (
                    <li className="text-sm text-muted-foreground">No notes yet.</li>
                )}
            </ul>
            <NoteComposer onAdd={(body) => mutate(() => api.addNote(issue.id, body))} />
        </section>
    );
}

export function Detail({ backlog, id }: { backlog: Backlog; id: number }) {
    const { config, issues, mutate } = backlog;
    const issue = issues.find((candidate) => candidate.id === id);

    if (config === undefined) return null;

    if (issue === undefined) {
        // Distinguishes "still loading" from "there is no such issue", which are very different answers.
        return (
            <div className="text-sm text-muted-foreground" data-testid="issue-missing">
                {backlog.loading ? "Loading…" : `No issue #${id}.`}
            </div>
        );
    }

    const parents = issues.filter((candidate) => candidate.id !== issue.id);
    const children = issues.filter((candidate) => candidate.parent === issue.id);

    return (
        <article className="flex flex-col gap-6" data-testid={`detail-${issue.id}`}>
            <header>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">#{String(issue.id).padStart(4, "0")}</span>
                    <span>·</span>
                    <span>created {issue.created.slice(0, 10)}</span>
                    <span>·</span>
                    <span>updated {issue.updated.slice(0, 10)}</span>
                </div>
                <EditableText
                    label="Title"
                    value={issue.title}
                    testId="edit-title"
                    onSave={(title) => mutate(() => api.update(issue.id, { title }))}
                />
            </header>

            <Fields issue={issue} config={config} parents={parents} mutate={mutate} />

            <EditableText
                label="Description"
                value={issue.description}
                multiline
                testId="edit-description"
                onSave={(description) => mutate(() => api.update(issue.id, { description }))}
            />

            <EditableText
                label="Plan"
                value={issue.plan}
                multiline
                testId="edit-plan"
                onSave={(plan) => mutate(() => api.update(issue.id, { plan }))}
            />

            {(issue.blockedBy.length > 0 || children.length > 0) && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {issue.blockedBy.length > 0 && (
                        <Related
                            label="Blocked by"
                            issues={issue.blockedBy
                                .map((blockerId) => issues.find((each) => each.id === blockerId))
                                .filter((each): each is IssueResponse => each !== undefined)}
                            highlight={new Set(issue.openBlockers)}
                        />
                    )}
                    {children.length > 0 && <Related label="Children" issues={children} />}
                </div>
            )}

            <Notes issue={issue} mutate={mutate} />
        </article>
    );
}

function Related({
    label,
    issues,
    highlight
}: {
    label: string;
    issues: IssueResponse[];
    highlight?: Set<number>;
}) {
    return (
        <section>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{label}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {issues.map((issue) => (
                    <li key={issue.id}>
                        <button
                            type="button"
                            onClick={() => navigate(href({ name: "issue", id: issue.id }))}
                            className="flex w-full items-baseline gap-2 p-2 text-left hover:bg-muted/60"
                        >
                            <span className="font-mono text-xs text-muted-foreground">
                                #{String(issue.id).padStart(4, "0")}
                            </span>
                            <span className="flex-1 text-sm">{issue.title}</span>
                            <span
                                className={cn(
                                    "text-xs",
                                    highlight?.has(issue.id) === true
                                        ? "text-started"
                                        : "text-muted-foreground"
                                )}
                            >
                                {issue.state}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
