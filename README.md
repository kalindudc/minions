# pi-minions

`pi-minions` is a lightweight pi extension for foreground subagent delegation. It lets a parent agent spawn isolated minion sessions, stream progress, inspect live activity, and halt running minions when needed.

## Features

- Foreground [`spawn`](docs/reference.md#spawn) via `tasks` for single minions or parallel batches
- Named agent discovery from pi/agents and minions directories
- Ephemeral built-in minions when no agent is specified
- `halt` for aborting running foreground minions
- `list_minions` and `show_minion` for current session visibility
- `/minions` and `/minions show <id|name>` for live activity viewing
- `learn_minions`, `/minions learn`, and `/minions skill` for built-in usage guidance
- In bb: nonblocking child-thread minions for every provider, managed from a [Minions tab](docs/reference.md#minions-tab)

Outside bb, background minions, live detaching, and user steering commands are not part of the public surface. In bb, minions are nonblocking child threads that report results through bb; the Minions tab lets you manage them.

## Quick start

```text
/spawn Summarize the test failures in this repository
/spawn Inspect src/tools and report risks --model claude-haiku
/minions
/minions show kevin
/minions learn
/halt kevin
```

For LLM-callable tools, use:

```ts
spawn({ tasks: [{ task: "Audit the auth module" }] })
spawn({ tasks: [{ task: "Read src" }, { task: "Read test" }] })
list_agents({})
list_minions({})
show_minion({ target: "kevin" })
halt({ id: "all" })
learn_minions({})
```

## Use in bb

This repository is also a bb plugin. Install it from Git, or from a local checkout after running `npm ci --ignore-scripts` in it. Do not install it from npm: the npm package contains only the pi extension, so `bb plugin install npm:pi-minions` would find no bb entry files.

```text
bb plugin install git:https://github.com/kalindudc/minions
bb plugin install path:/path/to/minions
```

Update pi-minions in pi to the same version before you install the plugin. pi-minions 0.19.0 and earlier register tools with the same names as the plugin, and pi refuses to start a bb thread that loads both.

In bb, every provider gets the [bb minion tools](docs/reference.md#bb-tools), personas accept [bb-only fields](docs/agents.md#bb-persona-fields), and pi sessions inside bb [hand their minion tools to the plugin](docs/reference.md#pi-inside-bb).

## Configuration

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

## Develop

Install the dependencies with `npm install`. It also runs `prepare`, which checks the toolchain and sets this repository's git hooks. Then:

- Run `bb plugin install path:$PWD` once, then `bb plugin dev $PWD` while you work. It rebuilds and reloads the plugin on every save anywhere in the repository except `dist/`, `node_modules/` and `.git/`, so saves under `tmp/` count too. Without it, `bb plugin reload pi-minions` rebuilds from the current files.
- bb applies tool and instruction changes only when a thread starts a new provider session, so test those changes in a new thread.
- pi sessions started in this checkout load `extensions/pi/` from the working tree, through `.pi/settings.json`. To use the checkout in every pi session, replace the package's git URL in `~/.pi/agent/settings.json` with the checkout path; put the URL back to switch back.

See [Contributing](docs/contributing.md) for the checks to run before review.

## Documentation

- [Getting started](docs/getting-started.md)
- [Patterns](docs/patterns.md)
- [Agents](docs/agents.md)
- [Reference](docs/reference.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [E2E testing](docs/e2e-testing.md)
- [Contributing](docs/contributing.md)

The npm package ships source plus standard npm always-included files. The `docs/` directory and changelog file are intentionally not included in the published tarball.
