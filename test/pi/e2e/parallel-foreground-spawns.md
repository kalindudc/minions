# Test: parallel-foreground-spawns

Verify that multiple foreground `spawn` calls in a single response execute in parallel.

## Setup

None.

## Action

Emit two separate `spawn` calls IN A SINGLE RESPONSE, each with a one-item
`tasks` array. Do NOT combine them into a batch:

```ts
spawn({ tasks: [{ task: "Say hello, then use the bash tool to run sleep 60", agent: "e2e-timeout" }] })
spawn({ tasks: [{ task: "Say hello, then use the bash tool to run sleep 60", agent: "e2e-timeout" }] })
```

After both complete, run:
```bash
grep -E "spawn:tool.*(start|completed|failed)" /tmp/logs/pi-minions/debug.log
```

## Expected

- Both spawn calls returned (transcript files for both minions exist under `/tmp/logs/pi-minions/minions/`)
- Each transcript contains `hello` (said before the sleep)
- The debug log contains two `spawn:tool.*start` lines both appearing before any `spawn:tool.*completed` or `spawn:tool.*failed` line — confirming concurrent start

## Cleanup

None.
