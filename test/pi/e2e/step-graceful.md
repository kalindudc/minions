# Test: step-graceful

Verify that a minion with `steps: 2` completes gracefully when it wraps up within the grace window after being steered.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Read this codebase and analyze it for duplication.", agent: "e2e-step-limit" }] })
```

## Expected

- The spawn tool completed without throwing an error (the parent received the minion's output, not an error)
- The spawned minion's transcript file exists
- The spawned minion's transcript contains the string `Step limit reached`
- The spawned minion's transcript does NOT contain the string `force abort`
- The spawned minion's transcript contains `Completed` (not `Aborted`)

## Cleanup

None.
