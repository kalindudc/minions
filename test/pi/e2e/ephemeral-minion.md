# Test: ephemeral-minion

Verify that a one-item `tasks` array without an agent name creates one ephemeral minion and returns a single-minion result.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "What is 2 + 2? Reply with just the number." }] })
```

Do NOT provide `agent` in the task entry.

After the spawn completes, read the minion's transcript file.

## Expected

- The spawn tool completed without error
- The response uses the single-minion result header `Minion <name> (<id>) completed.`, not a batch summary
- The minion's answer is `4`
- The spawned minion's transcript file exists
- The spawned minion's transcript contains the header `=== Minion:`
- The spawned minion's transcript contains `Completed`

## Cleanup

None.
