/**
 * Neutralise the environment that decides who authored a note.
 *
 * `resolveAuthor` prefers `MOTTE_AGENT` over everything else, so a suite run by anyone who has it set —
 * an agent working on this repository, for instance — attributed every note to that agent and three tests
 * asserting otherwise failed. It cost two rounds of chasing a "flaky" suite before the cause was caught,
 * because CI has neither variable set and only a developer machine could reproduce it.
 *
 * Cleared here rather than per test: any test that resolves an author is exposed, including ones that go
 * nowhere near the CLI harness, and a test that wants a particular author sets it explicitly.
 */

delete process.env.MOTTE_AGENT;
delete process.env.MOTTE_AUTHOR;
