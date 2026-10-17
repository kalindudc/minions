# Test: parallel-completion-staggered

Verify that 4 parallel foreground minions with staggered completion times all
complete successfully and all start before any complete.

## Setup

None.

## Action

Emit four separate `spawn` calls IN A SINGLE RESPONSE, each with a one-item
`tasks` array, so the calls run in parallel. Do NOT combine them into a batch.
The tasks are designed to finish at different speeds:

```ts
spawn({ tasks: [{ task: "Run bash: echo alpha. Then say: alpha done" }] })
spawn({ tasks: [{ task: "Run bash: sleep 2 && echo beta. Then say: beta done" }] })
spawn({ tasks: [{ task: "Run bash: echo gamma. Then say: gamma done" }] })
spawn({ tasks: [{ task: "Run bash: sleep 3 && echo delta. Then say: delta done" }] })
```

After all 4 complete, run:

grep -E "spawn:tool.*(start|completed|failed)" /tmp/logs/pi-minions/debug.log

## Expected

- All 4 spawn calls returned successfully (no errors)
- 4 transcript files exist under `/tmp/logs/pi-minions/minions/`
- Each transcript contains its expected output word (alpha, beta, gamma, delta respectively)
- The debug log shows all 4 `spawn:tool.*start` lines appearing before any `spawn:tool.*completed` or `spawn:tool.*failed` line — confirming concurrent start

## Cleanup

None.
