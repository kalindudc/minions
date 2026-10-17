# Test: step-limit

Verify that a minion with `steps: 2` gets steered and terminated gracefully.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Read every file in the extensions/pi/ directory one by one. For each file provide a 500 word summary.", agent: "e2e-step-limit" }] })
```

## Expected

- The spawned minion's transcript file exists
- The spawned minion's transcript contains the string `Step limit reached`
- Analyze the last turn marker: `--- turn N ---`, `N` must be less than or equal to 6

## Cleanup

None.
