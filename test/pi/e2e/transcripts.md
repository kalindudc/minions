# Test: transcripts

Verify per-minion transcript files are created with the expected structure.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Say hello in one sentence." }] })
```

After the spawn completes, use the minion name and ID from the spawn result header to locate the transcript at `/tmp/logs/pi-minions/minions/<id>-<name>.log`, then read it.

## Expected

- The transcript file exists
- The transcript contains the header `=== Minion:`
- The transcript contains at least one turn marker `--- turn 1 ---`

## Cleanup

None.
