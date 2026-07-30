---
name: work-issue
description: How to take a motte issue from Todo to Done in this repo — pick it up, build it, and pass the full gate (prettier, typecheck, tests, doctor, code review, fallow) before calling it complete. Use whenever working a ticket, closing an issue, or asked "what's next".
---

# Working an issue

This project tracks its own work in itself. An issue is not a note to yourself — it is the record
another person or agent will read to understand why the code looks the way it does. Treat the trail
you leave as part of the deliverable.

`motte` runs from source here: `bun run packages/cli/src/index.ts <args>`. Set `MOTTE_AGENT=claude`
so notes are attributed to the agent rather than the git user.

## 1. Pick it up

```bash
motte ready                 # unblocked work, in dependency order — start here
motte show <ref>            # description, plan, notes, blockers
motte status                # where the project stands
```

Read the **whole** issue including every note before touching code. Notes carry decisions,
corrections and dead ends; re-deriving them wastes the work that produced them. `motte ready` exists
so you do not start something blocked — prefer it to picking by id.

Then claim it:

```bash
motte move <ref> "in prog"
```

## 2. Refine the plan before building

If the issue's Plan is thin, wrong, or was written before something was learned, fix the Plan on the
issue first. A plan that says something impossible is worse than no plan — this has already happened
twice here (a plan calling for `Bun.$` in a vitest test, and one claiming two functions "differ only
in an early return" when following it would have broken `restore`).

```bash
motte edit <ref> --plan "1. ...
2. ..."
```

Record a decision as a note when you make a real choice — a trade-off, a rejected alternative, a
constraint you discovered. Not a progress diary.

```bash
motte note <ref> "Chose X over Y because ..."
```

## 3. Build

Conventions that are not negotiable:

- Prettier: 4-space, 100 columns, double quotes, no trailing comma. Run `bun run format`, do not
  hand-format.
- **Never `bun test`.** It is a different runner with different results. Always `bun run test`.
- **vitest runs on Node, so `Bun.*` globals are undefined in tests.** Use `node:crypto`, `node:zlib`,
  `node:http` in library code. Bun APIs belong in `scripts/` only.
- `.motte/` must never be added to `.gitignore`, and must stay in `.prettierignore` — Prettier's
  Markdown rules and motte's writer are not the same, so letting both format issue files makes
  `format:check` fail after any command that rewrites one.
- Core logic goes in `packages/core`. If a check is about stored data, it belongs on `IssueStore`
  next to its siblings, not in a command handler — that also makes it testable in-process, which
  command modules are not.

## 4. The gate

Run this **after the last change that touches the repo**, including any `motte` mutation. Both
failures pushed to CI in this project came from verifying and _then_ mutating.

`set -e` matters: gate on exit codes, do not eyeball output.

```bash
set -e
bun run format
bun run format:check
bun run typecheck
bun run test
bun run doctor
```

Notes on each:

- **Prettier** — `format` then `format:check`. Do not combine formatting and testing in one command;
  the concurrent file writes have caused two transient test failures here.
- **Lint** — there is no ESLint in this repo. `bun run typecheck` (`tsc --noEmit`, strict) is the
  lint. Treat a type error as a lint failure, never as something to cast away.
- **Tests** — `bun run test`, about 15s. `packages/cli/src/cli.test.ts` drives the CLI in-process
  through `main(argv)`; only its `wiring` block spawns a real process, for the few things that need
  one. If you add a spawning test, bound it — `spawnSync` blocks the worker thread, so vitest's
  `testTimeout` cannot interrupt it and a stuck child hangs the whole run.
- **doctor** — `bun run doctor` validates this repo's own backlog: duplicate ids, cycles, unknown
  states, round-trip integrity, stale work. CI runs it too, so a red doctor is a red build.

When a test fails, **check the fixture before believing the failure.** Four separate non-bugs in this
project traced to a flawed harness: an unquoted variable losing a trailing empty word, a stub
ignoring an argument, a leftover temp directory, and incoherent backdated timestamps. Also: `bun -e`
argv starts at index 1, a script file at 2.

## 5. Code review and fallow

Both are required before an issue is Done, not optional polish.

**Code review** — run `/code-review` over the diff. It has caught things every other check
passed, including a plan note that would have destroyed prune's safety guarantee and an MCP server
committed pointing at a machine-local binary. Fix what it finds or record on the issue why not.

**fallow** — audit the changed files, and feed it **real coverage**, or its CRAP scores are estimates
and will mislead you:

```bash
bun run test:coverage --coverage.reporter=json
```

Then `mcp__fallow__audit` with `base` set to the last commit before your work and `coverage` set to
`coverage/coverage-final.json`. Require `verdict: "pass"`, or specifically that every finding is
`introduced: false`.

Reading the result honestly:

- Findings marked `introduced: true` are yours. Fix them.
- `coverage_source: "estimated"` means fallow guessed. Subprocess tests are invisible to v8 coverage,
  so a command module can be thoroughly tested end-to-end and still read as 0%.
- **Do not suppress to get a pass.** When fallow flagged a pure function as untested, the right fix
  was an in-process test; when it flagged a check for inflating `doctor`'s complexity, the right fix
  was moving that check into core where it belonged. Both times the finding pointed at a real design
  problem, and the suppression comment would have hidden it.
- Do check whether a finding is inherited noise before acting — but say so out loud rather than
  quietly ignoring it.

## 6. Close it

Write a note that would let someone reconstruct your reasoning: what you decided, what you got wrong
on the way, what the next person should watch out for. Corrections belong here — this backlog
contains several, and they are the most useful notes in it.

```bash
motte note <ref> "..."
motte move <ref> done
```

If the work revealed a separate problem, file it rather than folding it in:

```bash
motte add "..." -p <parent> -l <labels> -d "..." --plan "..."
```

Then re-run the gate (you just mutated the backlog), commit, and push:

```bash
git commit -F - <<'MSG'
<subject: what changed and why, not the issue number>

<body: the reasoning, the trade-off, what it cost>

Closes #<id>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
git push origin main
```

## 7. Watch CI go green

An issue is not done when the push succeeds. **Wait for the run to complete and confirm the green SHA
is your HEAD** — a green tip one commit behind your push proves nothing.

```bash
gh run list --limit 1 --json headSha,status,conclusion
git rev-parse --short HEAD
```

If it fails, read the log before theorising:

```bash
gh run view <run-id> --log-failed
```

Report the outcome as it is. If something was skipped or left out, say so plainly.
