---
name: test-writer
description: Write and audit behaviour-based tests for pi-minions. Use when writing new tests or reviewing existing ones to ensure they verify expected outcomes, not implementation details.
---

# Test Writer

## Core rule

Derive every test from the expected behaviour, not from the code.
Before touching a test file, write the expectation in plain English:
"Given X state, when Y is called, Z is observable."
If you cannot write that sentence without reading the implementation, stop — the test does not exist yet.

## What to assert

Assert on observable outputs and state:
- Return values and thrown errors
- State changes on objects the caller controls (tree status, queue contents, node.detached)
- Messages sent across real system boundaries (pi.sendUserMessage)

Do NOT assert on internal call patterns:
- `expect(internalFn).toHaveBeenCalled()` tests implementation, not behaviour
- Internal collaborator calls are refactoring details — invisible to callers
- Exception: asserting a mock at an I/O boundary was called IS behaviour (e.g. `session.abort` was called means the session actually stopped)

## Where to mock

Mock only real I/O boundaries:
- LLM / network calls (createAgentSession, SDK)
- Time (vi.useFakeTimers for timeout tests)

Do NOT mock:
- Internal functions within the module under test
- Fast collaborators with no side effects

A mock on an internal function breaks when you refactor and tells you nothing about behaviour.

## File structure

One test file per source file, mirroring its path under the matching test root:
- src/ (core) → test/core/: src/agents.ts → test/core/agents.test.ts
- extensions/pi/ → test/pi/: extensions/pi/tools/spawn.ts → test/pi/tools/spawn.test.ts
- extensions/bb/ → test/bb/: extensions/bb/server.ts → test/bb/server.test.ts

Put each extension's helpers in its own `helpers/` folder (test/pi/helpers, test/bb/helpers). Repo-wide checks such as test/layout.test.ts sit at the test root.

Merge when two test files cover the same source file.

Group by scenario, not by function name:
- `describe("detach to background")` not `describe("detachMinion")`
- `it()` names describe the observable outcome, not the mechanism

## Audit checklist

Flag any test that:
- Has mock setup that no assertion depends on (dead setup)
- Pre-sets state in a way that bypasses the code path under test
- Asserts internal mock call counts for non-boundary functions
- Has a description that contradicts what the body actually asserts
- Breaks on a refactor that does not change observable behaviour

For each flagged test: rewrite from the plain-English behaviour statement, or delete it if no clear behaviour can be stated.
