# Test: batch-spawn

Verify a multi-item `tasks` array executes minions in parallel and returns one combined batch result.

## Setup

None.

## Action

Call the `spawn` tool once with three task entries:

```ts
spawn({
  tasks: [
    { task: "Return 'alpha'" },
    { task: "Return 'beta'" },
    { task: "Return 'gamma'" }
  ]
})
```

## Expected

- The tool returns successfully with one combined batch result from all 3 minions, not a single-minion result
- The result text contains `alpha`, `beta`, and `gamma`
- The debug log shows `batch-start` with count=3 and `batch-complete` with succeeded=3

Verify via:
```bash
grep -E "spawn:tool.*(batch-start|batch-complete)" /tmp/logs/pi-minions/debug.log
```

## Cleanup

None.
