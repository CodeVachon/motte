/** Zero-padded issue number used as the filename prefix, so files sort in id order. */
export const ID_PAD = 4;

export function padId(id: number): string {
    return String(id).padStart(ID_PAD, "0");
}

/**
 * Title to filename-safe slug. Intentionally lossy — the frontmatter is the source of truth for the
 * title, and the slug exists only to make the directory listing readable.
 */
export function slugify(title: string): string {
    const slug = title
        .normalize("NFKD")
        // Strip combining marks so "café" becomes "cafe" rather than "caf".
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .replace(/-+$/g, "");

    return slug.length > 0 ? slug : "issue";
}

export function issueFilename(id: number, title: string): string {
    return `${padId(id)}-${slugify(title)}.md`;
}

/** Read the id back off a filename. Returns undefined for names motte did not write. */
export function idFromFilename(filename: string): number | undefined {
    const match = /^(\d+)-.*\.md$/.exec(filename);
    if (!match) return undefined;
    const id = Number.parseInt(match[1]!, 10);
    return Number.isNaN(id) ? undefined : id;
}
