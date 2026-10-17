# Configuration

pi-minions reads settings from pi's global settings file and the project `.pi/settings.json`. Project settings override global settings.

```json
{
  "pi-minions": {
    "minionNames": ["kevin", "stuart", "bob"],
    "allowEphemeral": true,
    "display": {
      "outputPreviewLines": 20,
      "observabilityLines": 6,
      "showStatusHints": true,
      "spinnerFrames": ["[oo]", "[o-]", "[--]", "[-o]"]
    },
    "toolSync": {
      "enabled": true,
      "maxWait": 5
    }
  }
}
```

## minionNames

Array of display names used for ephemeral minions.

Default: built-in minion name pool.

bb minions use the built-in pool; this setting applies to pi's foreground minions.

## allowEphemeral

Whether [`spawn`](reference.md#spawn) may create a built-in ephemeral minion for a task entry that omits `agent`.

Default: `true`.

If disabled, every task entry must specify a named agent.

## display.outputPreviewLines

Number of lines to show in expanded spawn output previews.

Default: `20`.

## display.observabilityLines

Number of activity lines visible in the `/minions` live activity widget.

Default: `6`.

## display.showStatusHints

Whether the status line rotates lightweight hints while foreground minions are running.

Default: `true`.

## display.spinnerFrames

Spinner frame strings used by spawn rendering and status display.

Default: built-in `[oo]` style frames.

## toolSync.enabled

Whether minion sessions wait briefly for parent tools that register asynchronously.

Default: `true`.

## toolSync.maxWait

Maximum seconds to wait for asynchronous parent tool registration.

Default: `5`.
