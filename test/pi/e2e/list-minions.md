# Test: list-minions

Verify that the `list_minions` tool reports foreground minions retained in the current session tree.

## Setup

None.

## Action

First, call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Return the exact word list-check" }] })
```

After the foreground spawn completes, call the `list_minions` tool.

## Expected

- The `spawn` result contains `list-check`
- The `list_minions` result contains `Minions (`
- The `list_minions` result contains the minion name or ID from the `spawn` response
- The `list_minions` result contains `[completed]`

## Cleanup

None.
