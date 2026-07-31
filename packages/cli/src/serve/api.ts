import { z } from "zod";
import {
    AmbiguousRefError,
    CycleError,
    DependencyCycleError,
    IssueNotFoundError,
    IssueStore,
    blocked,
    buildTree,
    openBlockers,
    projectReport,
    ready,
    stateCategory,
    subtreeOf,
    type Config,
    type Issue,
    type TreeNode
} from "@motte/core";
import { issueJson } from "../context.js";

/**
 * The JSON API, as a function from a request to a response.
 *
 * Deliberately free of `node:http`. Everything worth getting wrong here — which body shapes are accepted,
 * which status code a given failure maps to, what the response looks like — is decided in this file and
 * tested directly, leaving the HTTP layer with nothing but parsing and plumbing.
 */

export interface ApiRequest {
    method: string;
    /** Path with the `/api` prefix already removed, e.g. `/issues/12`. */
    path: string;
    query: URLSearchParams;
    /** Parsed JSON body, or undefined for a request that carried none. */
    body?: unknown;
}

export interface ApiResponse {
    status: number;
    body: unknown;
}

export interface ApiContext {
    config: Config;
    store: IssueStore;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
const fail = (status: number, error: string): ApiResponse => ({ status, body: { error } });

/**
 * Writes accept exactly the fields the CLI accepts, and no others.
 *
 * `strict()` matters: a typo in a key would otherwise be silently ignored, and the caller would get a 200
 * with nothing changed. `id`, `created` and `updated` are absent on purpose — identity and timestamps are
 * the store's to manage.
 */
const CreateBody = z
    .object({
        title: z.string().min(1),
        description: z.string().optional(),
        plan: z.string().optional(),
        state: z.string().min(1).optional(),
        parent: z.number().int().positive().nullable().optional(),
        assignee: z.string().min(1).nullable().optional(),
        labels: z.array(z.string().min(1)).optional(),
        blockedBy: z.array(z.number().int().positive()).optional()
    })
    .strict();

const PatchBody = CreateBody.partial().strict();

const NoteBody = z
    .object({
        body: z.string().min(1),
        author: z.string().min(1).optional(),
        /** The web UI is a person's surface, so a note from it is a person's note unless it says otherwise. */
        authorType: z.enum(["user", "agent"]).optional()
    })
    .strict();

/**
 * One issue, as the API returns it.
 *
 * Derived from the function that builds it rather than declared separately, so it cannot describe something
 * the server does not send. `apps/web` imports this as a type-only import, which the bundler erases.
 */
export type IssueResponse = ReturnType<typeof issueWithContext>;

/** The list endpoint's envelope. */
export interface IssueListResponse {
    count: number;
    issues: IssueResponse[];
}

/** What `GET /api/config` returns: enough for the UI to render states it has never seen before. */
export type ConfigResponse = ReturnType<typeof configBody>;

/** What `GET /api/status` returns: the progress report, plus what can be picked up and what cannot. */
export type StatusResponse = ReturnType<typeof statusBody>;

/**
 * A node of `GET /api/tree`.
 *
 * Declared rather than derived, because the shape is recursive and `ReturnType` cannot express that.
 * `treeJson` returns this type, so the compiler still checks the two agree.
 */
export interface TreeNodeResponse {
    id: number;
    title: string;
    state: string;
    children: TreeNodeResponse[];
}

export interface TreeResponse {
    roots: TreeNodeResponse[];
    problems: string[];
}

/** Every failure answers with this, whatever the status. */
export interface ErrorResponse {
    error: string;
}

function issueWithContext(config: Config, issues: Issue[], issue: Issue) {
    return {
        ...issueJson(issue),
        // Derived, and the whole reason a board can grey out what cannot be started yet.
        openBlockers: openBlockers(config, issues, issue).map((blocker) => blocker.id),
        children: issues
            .filter((candidate) => candidate.parent === issue.id)
            .map((child) => child.id)
    };
}

function configBody(config: Config) {
    return {
        name: config.name,
        states: config.states,
        defaultState: config.defaultState,
        root: config.root,
        events: config.events
    };
}

function statusBody(config: Config, issues: Issue[]) {
    const report = projectReport(config, issues);

    return {
        ...report,
        // Ids, not whole issues. `projectReport` hands back full `Issue` objects here, which would put
        // `unknownSections` and absolute file paths into an API response — noise the client cannot use, and
        // the same trimming the MCP shape does for the same reason.
        inProgress: report.inProgress.map((issue) => issue.id),
        ready: ready(config, issues).map((issue) => issue.id),
        blocked: blocked(config, issues).map((issue) => issue.id)
    };
}

function treeJson(node: TreeNode): TreeNodeResponse {
    return {
        id: node.issue.id,
        title: node.issue.title,
        state: node.issue.state,
        children: node.children.map(treeJson)
    };
}

/** Map the errors core throws onto status codes, so every route reports them the same way. */
function fromThrown(thrown: unknown): ApiResponse {
    if (thrown instanceof IssueNotFoundError) return fail(404, thrown.message);
    if (thrown instanceof AmbiguousRefError) return fail(400, thrown.message);
    // A cycle is a well-formed request that conflicts with the current shape of the backlog.
    if (thrown instanceof CycleError || thrown instanceof DependencyCycleError) {
        return fail(409, thrown.message);
    }
    if (thrown instanceof Error) return fail(400, thrown.message);
    return fail(500, String(thrown));
}

function parseId(raw: string): number | undefined {
    // Only a plain positive integer. Title-fragment resolution is a convenience for humans typing at a
    // shell; a URL built by the UI should be unambiguous.
    if (!/^\d+$/.test(raw)) return undefined;
    const id = Number(raw);
    return id > 0 ? id : undefined;
}

function listIssues(context: ApiContext, query: URLSearchParams): ApiResponse {
    const { config, store } = context;
    let issues = store.all();

    const state = query.get("state");
    if (state !== null) {
        const needle = state.toLowerCase();
        issues = issues.filter((issue) => issue.state.toLowerCase() === needle);
    }

    const label = query.get("label");
    if (label !== null) {
        const needle = label.toLowerCase();
        issues = issues.filter((issue) =>
            (issue.labels ?? []).some((each) => each.toLowerCase() === needle)
        );
    }

    const assignee = query.get("assignee");
    if (assignee !== null) {
        const needle = assignee.toLowerCase();
        issues = issues.filter((issue) => issue.assignee?.toLowerCase() === needle);
    }

    if (query.get("open") === "true") {
        issues = issues.filter((issue) => {
            const category = stateCategory(config, issue.state);
            return category !== "completed" && category !== "cancelled";
        });
    }

    const all = store.all();
    return ok({
        count: issues.length,
        issues: issues.map((issue) => issueWithContext(config, all, issue))
    });
}

function createIssue(context: ApiContext, body: unknown): ApiResponse {
    if (body === undefined) return fail(400, "a JSON object body is required");

    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) return fail(400, describe(parsed.error));

    const { title, parent, assignee, ...rest } = parsed.data;

    const issue = context.store.create({
        title,
        ...rest,
        // `null` is how the UI says "no parent"; core wants the key absent.
        ...(parent === undefined || parent === null ? {} : { parent }),
        ...(assignee === undefined || assignee === null ? {} : { assignee })
    });

    return created(issueWithContext(context.config, context.store.all(), issue));
}

function patchIssue(context: ApiContext, id: number, body: unknown): ApiResponse {
    if (body === undefined) return fail(400, "a JSON object body is required");

    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) return fail(400, describe(parsed.error));
    if (Object.keys(parsed.data).length === 0) return fail(400, "no fields to update");

    // `null` clears; omitted leaves alone. The store's patch type uses the same distinction, so the two
    // agree without translation beyond this.
    const issue = context.store.update(id, parsed.data);
    return ok(issueWithContext(context.config, context.store.all(), issue));
}

function addNote(context: ApiContext, id: number, body: unknown): ApiResponse {
    if (body === undefined) return fail(400, "a JSON object body is required");

    const parsed = NoteBody.safeParse(body);
    if (!parsed.success) return fail(400, describe(parsed.error));

    const issue = context.store.addNote(id, parsed.data.body, {
        ...(parsed.data.author === undefined ? {} : { name: parsed.data.author }),
        type: parsed.data.authorType ?? "user"
    });

    return created(issueWithContext(context.config, context.store.all(), issue));
}

function describe(error: z.ZodError): string {
    return error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
}

/** The read-only endpoints. Returns undefined when the path is not one of them. */
function readRoutes(context: ApiContext, request: ApiRequest): ApiResponse | undefined {
    const { config, store } = context;

    if (request.method !== "GET") return undefined;

    if (request.path === "/config") return ok(configBody(config));

    if (request.path === "/status") return ok(statusBody(config, store.all()));

    if (request.path === "/tree") {
        const issues = store.all();
        const { roots, problems } = buildTree(issues);
        const ref = request.query.get("ref");

        return ok({
            roots: (ref === null ? roots : subtreeOf(roots, store.resolve(ref).id)).map(treeJson),
            problems: problems.map((problem) => problem.message)
        });
    }

    return undefined;
}

/**
 * Resolve the `:id` segment, or answer the request explaining why it could not be.
 *
 * A helper rather than the same two lines in each route: the repeated guard is most of what put this
 * file's router over the cognitive-complexity threshold.
 */
function withId(raw: string, handle: (id: number) => ApiResponse): ApiResponse {
    const id = parseId(raw);
    if (id === undefined) return fail(400, `"${raw}" is not an issue number`);
    return handle(id);
}

/** The issue endpoints, including the note sub-resource. Returns undefined when the path is not one. */
function issueRoutes(context: ApiContext, request: ApiRequest): ApiResponse | undefined {
    const { config, store } = context;

    if (request.path === "/issues") {
        if (request.method === "GET") return listIssues(context, request.query);
        if (request.method === "POST") return createIssue(context, request.body);
        return fail(405, `${request.method} is not allowed on /api/issues`);
    }

    const single = /^\/issues\/([^/]+)$/.exec(request.path);
    if (single) {
        return withId(single[1]!, (id) => {
            if (request.method === "GET") {
                return ok(issueWithContext(config, store.all(), store.require(id)));
            }
            if (request.method === "PATCH") return patchIssue(context, id, request.body);
            return fail(405, `${request.method} is not allowed on /api/issues/:id`);
        });
    }

    const notes = /^\/issues\/([^/]+)\/notes$/.exec(request.path);
    if (notes) {
        return withId(notes[1]!, (id) =>
            request.method === "POST"
                ? addNote(context, id, request.body)
                : fail(405, `${request.method} is not allowed on /api/issues/:id/notes`)
        );
    }

    return undefined;
}

/**
 * Route a request.
 *
 * Never throws: everything core can raise is mapped to a status code, because an exception escaping here
 * would take down a request the browser is waiting on with no useful body.
 */
export function handleApi(context: ApiContext, request: ApiRequest): ApiResponse {
    try {
        return (
            readRoutes(context, request) ??
            issueRoutes(context, request) ??
            fail(404, `no such endpoint: ${request.path}`)
        );
    } catch (thrown) {
        return fromThrown(thrown);
    }
}
