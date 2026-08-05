import { useEffect, useRef, useState } from "react";
import { api, ApiError, type SearchResponse } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { href, navigate } from "../lib/router.js";

/**
 * Searching from the browser.
 *
 * The board shows every issue and, until this, offered no way to find one — the views were built when there
 * were twenty of them. It goes through the server's `/api/search`, which runs the same core function the CLI
 * does, so the two cannot answer differently.
 *
 * An overlay rather than a route: searching is something you do *from* wherever you are, and coming back to
 * the board afterwards should not need the back button.
 */

/** How long after the last keystroke to ask the server. */
const SETTLE_MS = 180;

interface SearchProps {
    onClose: () => void;
}

export function Search({ onClose }: SearchProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResponse | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [selected, setSelected] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        input.current?.focus();
    }, []);

    useEffect(() => {
        if (query.trim().length === 0) {
            setResults(undefined);
            return;
        }

        // Debounced, because every keystroke would otherwise re-read the whole backlog on the server.
        const timer = setTimeout(() => {
            api.search(query)
                .then((found) => {
                    setResults(found);
                    setSelected(0);
                    setError(undefined);
                })
                .catch((thrown: unknown) => {
                    setError(thrown instanceof ApiError ? thrown.message : String(thrown));
                });
        }, SETTLE_MS);

        return () => clearTimeout(timer);
    }, [query]);

    const issues = results?.issues ?? [];

    const open = (id: number): void => {
        navigate(href({ name: "issue", id }));
        onClose();
    };

    const onKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === "Escape") {
            onClose();
            return;
        }

        if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
            event.preventDefault();
            setSelected((current) => Math.min(current + 1, Math.max(0, issues.length - 1)));
            return;
        }

        if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
            event.preventDefault();
            setSelected((current) => Math.max(0, current - 1));
            return;
        }

        if (event.key === "Enter") {
            const issue = issues[selected];
            if (issue !== undefined) open(issue.id);
        }
    };

    return (
        <div
            className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 pt-24"
            // A click on the backdrop closes it, which is what everybody expects of an overlay.
            onClick={onClose}
            data-testid="search"
        >
            <div
                className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-lg"
                onClick={(event) => event.stopPropagation()}
            >
                <input
                    ref={input}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search titles, descriptions, plans and notes…"
                    className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
                    data-testid="search-input"
                />

                <div className="max-h-96 overflow-y-auto">
                    {error !== undefined && (
                        <p className="px-4 py-3 text-sm text-started" data-testid="search-error">
                            {error}
                        </p>
                    )}

                    {error === undefined && query.trim().length > 0 && issues.length === 0 && (
                        <p
                            className="px-4 py-3 text-sm text-muted-foreground"
                            data-testid="search-empty"
                        >
                            Nothing matches “{query}”.
                        </p>
                    )}

                    {issues.map((issue, index) => (
                        <button
                            key={issue.id}
                            type="button"
                            onClick={() => open(issue.id)}
                            onMouseEnter={() => setSelected(index)}
                            className={cn(
                                "block w-full border-b border-border px-4 py-3 text-left last:border-b-0",
                                index === selected ? "bg-muted" : "hover:bg-muted/60"
                            )}
                            data-testid={`search-result-${issue.id}`}
                        >
                            <span className="font-mono text-xs text-muted-foreground">
                                #{String(issue.id).padStart(4, "0")}
                            </span>{" "}
                            <span className="text-sm font-medium">{issue.title}</span>
                            {issue.hits.map((hit, hitIndex) => (
                                <span
                                    key={`${hit.field}-${hit.lineNumber}-${hitIndex}`}
                                    className="mt-1 block text-xs text-muted-foreground"
                                >
                                    {/* Where it was, so a hit in a note reads differently from one in a
                                        plan — the same distinction the CLI draws. */}
                                    <span className="font-mono">
                                        {hit.note === undefined
                                            ? `${hit.field}:${hit.lineNumber}`
                                            : `note ${hit.note.at.slice(0, 10)} ${hit.note.author.name}`}
                                    </span>{" "}
                                    {hit.line}
                                </span>
                            ))}
                            {issue.totalHits > issue.hits.length && (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    and {issue.totalHits - issue.hits.length} more in this issue
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {results !== undefined && issues.length > 0 && (
                    <p
                        className="border-t border-border px-4 py-2 text-xs text-muted-foreground"
                        data-testid="search-count"
                    >
                        {results.count} issue{results.count === 1 ? "" : "s"} · ↑↓ to move, enter to
                        open, esc to close
                    </p>
                )}
            </div>
        </div>
    );
}
