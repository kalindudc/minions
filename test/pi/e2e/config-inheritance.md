# Test: config-inheritance

Verify that a minion inherits configuration from the parent session, specifically that it has access to standard coding tools.

## Setup

None.

## Action

Call the `spawn` tool with:

```ts
spawn({ tasks: [{ task: "Use the bash tool to run: echo \"CONFIG_INHERITANCE_MARKER_12345\". Report the output." }] })
```

After the spawn completes, read the minion's transcript file.

## Expected

- The spawn tool completed without error
- The spawned minion's transcript contains `CONFIG_INHERITANCE_MARKER_12345`
- The spawned minion's transcript contains `[tool:start] bash` (confirming the minion had access to bash tool)

## Cleanup

None.
