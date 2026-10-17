# Test: recursion-prevention

Verify that a spawned minion does NOT have access to the spawn tool (preventing infinite recursion).

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Try to use the spawn tool to delegate a subtask. If you cannot find a spawn tool, report \"NO_SPAWN_TOOL_AVAILABLE\". Do NOT make up tool names." }] })
```

After the spawn completes, extract the minion's output from the spawn result.

## Expected

- The spawn tool completed without error
- The spawn result output contains `NO_SPAWN_TOOL_AVAILABLE` OR the spawn result does NOT contain any indication that a sub-minion was successfully spawned (no "Minion" and "completed" together in the minion's output)

## Cleanup

None.
