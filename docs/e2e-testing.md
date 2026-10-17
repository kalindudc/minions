# E2E testing

The e2e suite uses markdown specs that a real LLM executes inside pi. Specs should be mechanical, observable, and clean up after themselves.

## Run

```bash
npm run test:e2e
```

## Spec structure

Use this shape:

```md
# Test: name

Verify one behavior.

## Setup

Required fixtures.

## Action

Exact tool calls or commands.

## Expected

Observable success criteria.

## Cleanup

Cleanup actions, or None.
```

## Foreground minion patterns

Use the [spawn reference](reference.md#spawn) for tool inputs and result shapes.

### Spawn and inspect completed tree state

1. Call `spawn` with one entry in `tasks`, using a short task that returns a unique token.
2. Check that the result describes one minion rather than a batch, then extract its id or name.
3. Call `list_minions` or `show_minion`.
4. Assert the unique token or completed status appears where relevant.

### Batch spawn

Use one `spawn` call with at least two task entries and assert every task's expected token appears in the combined result.

### Halt availability

If no running minion is available, `halt({ id: "all" })` should report that no minions are running rather than crashing. Unit tests cover aborting an active foreground session.

### Learn surface

Call `learn_minions` and assert the response documents the current [spawn contract](reference.md#spawn), `list_agents`, and unavailable background/live-detach/user-steering surfaces.

## Current specs

| Spec | Main surface |
|---|---|
| `batch-spawn` | Batch foreground `spawn` |
| `parallel-foreground-spawns` | Parallel foreground tool calls |
| `halt-minion` | `halt` informational path |
| `list-minions` | `list_minions` after foreground spawn |
| `show-minion` | `show_minion` after foreground spawn |
| `learn-minions` | `learn_minions` |
| `extension-loading` | Extension registration |
| `ephemeral-minion` | Ephemeral foreground minion |
| `agent-not-found` | Named agent error path |
| `config-inheritance` | Settings inheritance |
| `recursion-prevention` | Extension recursion filtering |
| `step-limit`, `step-graceful`, `timeout` | Internal safety controls |
| `logging`, `transcripts` | Debug logs and transcript files |
