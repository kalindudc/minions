# Test: halt-minion

Verify that the `halt` tool remains available and reports clearly when no foreground minions are running.

## Setup

None.

## Action

Call the `halt` tool with:
- `id`: `all`

## Expected

- The `halt` result contains `No running minions`
- The result is informational rather than a crash

## Cleanup

None.
