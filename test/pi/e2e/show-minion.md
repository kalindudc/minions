# Test: show-minion

Verify that the `show_minion` tool displays detailed foreground minion status from the current session tree.

## Setup

None.

## Action

First, call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Return the exact word show-check" }] })
```

Extract the minion name or ID from the `spawn` response.

After the foreground spawn completes, call the `show_minion` tool with:
- `target`: the minion name or ID from above

## Expected

- The `spawn` result contains `show-check`
- The `show_minion` result contains `Status: completed`
- The `show_minion` result contains `Task:`
- The `show_minion` result contains `Usage:`

## Cleanup

None.
