# Test: agent-not-found

Verify that spawning with a non-existent agent name returns a clear error.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Say hello.", agent: "nonexistent-agent-xyz" }] })
```

The tool call is expected to fail.

## Expected

- The spawn tool returned an error (either threw or returned error content)
- The error message contains the text `not found` (case-insensitive)

## Cleanup

None.
