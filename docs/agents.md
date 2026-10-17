# Agents

Agents are reusable minion configurations discovered from global and project directories.

## Discovery locations

pi-minions discovers agents and minions from:

- `~/.pi/agent/agents/`
- `~/.pi/agent/minions/`
- `~/.agents/agents/`
- `~/.agents/minions/`
- `.pi/agents/`
- `.pi/minions/`
- `.agents/agents/`
- `.agents/minions/`

Project agents override global agents with the same name.

## Agent file format

```md
---
name: researcher
description: Researches a topic and reports concise findings
model: claude-haiku
---

You are a focused research minion. Return sources, findings, and risks.
```

Common frontmatter fields:

| Field | Purpose |
|---|---|
| `name` | Agent name selected by `tasks[].agent` in [`spawn`](reference.md#spawn) |
| `description` | Shown by `list_agents` |
| `displayName` | Preferred minion display name |
| `model` | Default model for this agent |
| `tools` | Optional tool allowlist |
| `thinking` | Optional thinking level |
| `steps` | Optional turn limit |
| `timeout` | Optional timeout in milliseconds (pi sessions only) |
| `provider`, `reasoning`, `permission`, `environment`, `delegate` | bb-only provider, effort, permission, shared/worktree and depth-limited delegation settings; see [bb persona fields](#bb-persona-fields) |

## Invalid persona files

A persona file whose frontmatter is not valid YAML, or that sets an invalid [bb persona field](#bb-persona-fields), is skipped; the other personas still load. pi-minions reports each skipped file with its path and the reason:

- `list_agents` lists skipped files after the available personas, in pi and in bb.
- pi shows them in one notice when a session starts.
- In bb they also appear in the Minions tab's New minion form and in the plugin log.

A spawn that names a skipped persona fails with that file's path and reason. A skipped file still claims its persona name, so it never lets a lower-precedence persona with the same name run in its place.

## Use an agent

```ts
list_agents({})
spawn({ tasks: [{ task: "Compare migration options", agent: "researcher" }] })
```

Set `model` on the task entry to override the agent default for that run.

```ts
spawn({
  tasks: [
    { task: "Review the architecture", agent: "researcher", model: "claude-sonnet" }
  ]
})
```

## bb persona fields

bb reads these optional fields when it spawns a persona as a [bb minion](reference.md#bb-tools); plain pi ignores them. A file with an invalid value is skipped like any other [invalid persona file](#invalid-persona-files).

| Field | Values | Default | Effect in bb |
|---|---|---|---|
| `provider` | a bb provider id, such as `codex` or `pi` | the calling thread's provider | Provider that runs the child thread |
| `reasoning` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `thinking` mapped to bb levels (`off` becomes `none`, `minimal` becomes `low`), else the caller's level when the minion runs on the caller's provider and the model supports it, else the model's own default level | Reasoning effort; a level the model does not support fails the task |
| `permission` | `accept-edits`, `auto`, `full` | bb's default for child threads | Permission mode, never above the host's ceiling |
| `environment` | `shared`, `worktree` | `shared` | The caller's checkout, or a new Git worktree from the caller's branch |
| `delegate` | `true`, `false` | `false` | Whether the minion may spawn minions of its own, at most two levels deep |

In bb, `model` must name a model in the provider's catalog, as an exact id or a unique suffix after `/`. A persona that names another `provider` but no `model` runs on that provider's default model, because the caller's model belongs to a different catalog. `tools` is advisory in bb: bb chooses each thread's tools, so the list does not restrict a bb minion. `steps` and `timeout` apply only to pi sessions.

```md
---
name: reviewer
description: Reviews a change in its own worktree
provider: codex
model: gpt-5.2
reasoning: high
environment: worktree
---

You are a careful reviewer. Report bugs with file and line.
```

## Ephemeral minions

If a task entry omits `agent`, pi-minions creates a built-in ephemeral minion when [`allowEphemeral`](configuration.md#allowephemeral) is enabled.
