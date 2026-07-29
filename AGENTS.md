# Agent Rules

Before completing work in this repository, always run all of the following:

- `bun run typecheck`
- `bun run test`
- `bun run doctor`

`bun run doctor` runs `motte doctor` against this repository's own backlog. It exits non-zero when
an issue file is malformed, an id is duplicated, a parent is missing, or the tree contains a cycle.

Test runs must always use `bun run test`.

Do not use `bun test` in this repository because it uses a different runner and can produce
different results.

## This project is managed by itself

motte tracks its own work in `.motte/issues/`. Do not keep ad-hoc TODO lists, and do not track work
only in a commit message or a pull request description.

Start by asking what is actually available:

```
motte ready
```

That is not the same as `motte list`. Ready means unsettled with every blocker settled — it filters
out work that cannot be started yet. Do not pick up something from `motte ready --blocked` without
first clearing what it waits on, or moving the blocker out of the way deliberately.

The loop for any issue you pick up:

1. Read the issue — `motte show <ref>`
2. Refine its **Plan** if the plan on the file is not what you are actually going to do
3. Move it to In Progress — `motte move <ref> "in progress"`
4. Add notes as you go, especially for decisions and dead ends — `motte note <ref> "..."`
5. Move it to Done when the verification for that issue passes

If you discover a prerequisite mid-task, record it (`motte block <ref> <blocker>`) rather than
describing it in prose — prose is not queryable, and `motte ready` is what the next agent reads.

Notes you write are recorded as authored by the agent. Notes written through the CLI by a person are
recorded as authored by the git user. Both land in the same file — that is the point.

Every command accepts either an issue number or a fragment of its title, so `motte show schema`
works as well as `motte show 12`.

## Repository conventions

- Bun workspaces. `packages/core` is pure — no `yargs`, no `chalk`, no HTTP. Adapters live in
  `packages/cli`.
- Tests sit beside their source as `*.test.ts`.
- Prettier settings are not negotiable: 4-space, 100 columns, double quotes, no trailing comma.
- Distribution is Bun-compiled binaries only. There is no npm publish and no node-compat build
  target, so Bun APIs are fair game. Do not add one.
- `.motte/` must never be added to `.gitignore`.
