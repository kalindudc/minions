# Test: learn-minions

Verify that the built-in learning surface is available without packaged docs.

## Setup

None.

## Action

Call the `learn_minions` tool with no parameters.

## Expected

- The result contains `# pi-minions`
- The result documents foreground `spawn` with a required, non-empty `tasks` array
- The result places required `task` and optional `agent` and `model` on each task entry, not at the top level
- The result distinguishes one-item single-minion runs/results/displays from concurrent batches of two or more items
- The result keeps `/spawn <task> [--model <model>]` as the slash-command syntax
- The result mentions `list_agents`
- The result states `Background minions are not available`
- The result states `Live detach is not available`
- The result states `User steering is not available`

## Cleanup

None.
