# Test: logging

Verify the debug log contains structured entries when a minion is spawned.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Say hello in one sentence." }] })
```

After the spawn completes, extract the minion ID from the spawn result header (`Minion <name> (<id>) completed.`), then run:
```bash
grep '<MINION_ID>' /tmp/logs/pi-minions/debug.log | grep '\[INFO\].*spawn:tool'
```
Replace `<MINION_ID>` with the actual ID.

## Expected

- The grep command produces at least one line containing `[INFO]` and `spawn:tool` for that minion ID

## Cleanup

None.
