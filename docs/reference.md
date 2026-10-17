# Reference

## Tools

| Tool | Purpose |
|---|---|
| `spawn` | Run foreground minions in pi; in bb, create child threads and return immediately while bb delivers their results |
| `halt` | Abort a running foreground minion by id, name, or `all` |
| `list_agents` | List available named agents plus the built-in ephemeral minion when enabled |
| `list_minion_types` | Alias surface for listing available minion types |
| `list_minions` | List current foreground minions retained in the session tree |
| `show_minion` | Show detailed status, activity, usage, and history for one minion |
| `learn_minions` | Return built-in usage guidance |

### spawn

`tasks` is the only top-level option. It is required and must be a non-empty array of objects with a required `task` string and optional `agent` and `model` strings. Top-level `task`, `agent`, and `model` options are not supported.

- One item runs one foreground minion with a single-minion result and display, not a batch wrapper.
- Two or more items run concurrently as a batch with a combined result and batch display.

Single foreground minion:

```ts
spawn({ tasks: [{ task: "Read src/index.ts and summarize it" }] })
```

Named agent and model override for one task entry:

```ts
spawn({
  tasks: [
    { task: "Research package files", agent: "researcher", model: "claude-haiku" }
  ]
})
```

Batch foreground minions:

```ts
spawn({
  tasks: [
    { task: "Inspect source" },
    { task: "Inspect tests", agent: "tester" }
  ]
})
```

See [Agents](agents.md) for named configurations and model defaults.

### halt

```ts
halt({ id: "kevin" })
halt({ id: "all" })
```

### list_agents and list_minion_types

```ts
list_agents({})
list_minion_types({})
```

### list_minions

```ts
list_minions({})
```

Returns a text summary and details containing foreground minion id, name, task, status, agent name, model, and last activity.

### show_minion

```ts
show_minion({ target: "kevin" })
```

`target` can be a minion id or name.

### learn_minions

```ts
learn_minions({})
```

Returns the same concise skill text exposed by `/minions learn` and `/minions skill`.

## bb tools

When pi-minions is installed as a bb plugin, bb gives these tools to threads of every provider. A minion thread gets all of them except `spawn`, unless its persona sets `delegate: true` and it is less than two levels deep.

| Tool | Parameters | Result |
|---|---|---|
| `spawn` | `{ tasks: [{ task, agent?, model?, environment? }] }` | One line per task, returned at once |
| `list_agents` | `{}` | Personas with their description, provider and model |
| `list_minions` | `{}` | This thread's minions with status, model and quest progress |
| `show_minion` | `{ id }` | One minion's status and final answer |
| `halt` | `{ id }` | Stops one minion, or every running minion with `id: "all"` |

### spawn in bb

`tasks` holds one to eight objects, and neither level accepts other properties:

- `task` (required): a non-empty, self-contained instruction.
- `agent`: a persona name from `list_agents`. Omit it for a general-purpose minion.
- `model`: an exact model id, or a unique suffix after `/`, so `gpt-6-luna` matches `openai/gpt-6-luna`.
- `environment`: `shared`, the caller's checkout, or `worktree`, a new managed worktree from the caller's branch. It defaults to the persona's `environment`, then `shared`.

Each minion runs on the persona's `provider` or the caller's provider. Its model is the task's `model`, then the persona's `model`, then the caller's current model, or the provider's default model when the persona names another provider. Its reasoning level is the persona's, else the caller's when the minion runs on the caller's provider and the model supports that level, else the model's default level, so every spawn names one. An unknown persona, a persona whose file was skipped, a model that matches nothing or more than one model, an unsupported reasoning level or a permission above the host ceiling fails only that task, and the error lists the valid choices. See [bb persona fields](agents.md#bb-persona-fields).

`spawn` does not wait. bb nests each minion under the calling thread and reports back to the caller on its own. A completed minion's report includes its answer, cut at 4,000 characters. A failed or interrupted minion, or one that needs help, comes as a status notice without an answer. Reports that arrive within about 2 seconds of each other come as one list without answers. A minion stopped with `halt` or from the Minions tab sends no report. Do not poll; read a full answer with `show_minion`.

```ts
spawn({
  tasks: [
    { task: "Find where sessions expire and cite the files", agent: "researcher" },
    { task: "Draft a fix in an isolated checkout", environment: "worktree", model: "gpt-6-luna" }
  ]
})
```

### show_minion and halt in bb

```ts
show_minion({ id: "thr_abc123" })
halt({ id: "thr_abc123" })
halt({ id: "all" })
```

`id` is a minion's thread id from `spawn` or `list_minions`. Both tools act only on minions of the calling thread. `show_minion` returns up to 50,000 characters and says when it cut the answer short.

## Minions tab

In bb, each thread shows its minions in the Minions tab and in the Minions button in the composer.

| Surface | What it does |
|---|---|
| Minions tab | Opened from the right panel's Actions list or the Minions button. Lists each minion's persona, task, provider and model, status, elapsed time, quest progress and answer preview |
| Minion detail | Selecting a minion shows its conversation, with Open (go to the thread), Message, Stop and Archive |
| New minion | A form in the tab that starts one minion from a persona, a task and a shared or worktree environment |
| Minions button | `[oo]` in the composer toolbar, beside voice and send. Hovering shows the thread's running, waiting, done and failed counts, and clicking opens the tab. It blinks while a minion runs (unless the system asks for reduced motion), turns amber while one waits for input and is muted when the thread has none. In a minion thread, hovering names the persona and clicking opens the parent thread. bb hides it while the composer is collapsed to one line |

Archived minions leave the list.

## pi inside bb

When pi runs inside bb with this plugin installed, bb supplies the minion tools and pi-minions registers none of its tools, commands, renderer or hooks. pi-minions steps aside when bb's `PI_BB_TOOLS_FILE` lists a `spawn` tool, or lists all of `list_agents`, `list_minions`, `show_minion` and `halt`, which is how bb equips a minion that may not delegate. In every other case, including plain pi and Herdr, pi keeps its foreground minions.

## Commands

| Command | Purpose |
|---|---|
| `/spawn <task> [--model <model>]` | Ask the parent to call foreground `spawn` |
| `/minions` | Open live activity for the first running foreground minion |
| `/minions show <id\|name>` | Open live activity for a specific minion |
| `/minions list` | List available minion types |
| `/minions learn` | Show usage guidance |
| `/minions skill` | Show the built-in skill text |
| `/minions version` | Show package version |
| `/minions help` | Show command help |
| `/halt <id\|name\|all>` | Halt running foreground minions |

## Types

| Type | Key fields |
|---|---|
| `AgentConfig` | `name`, `description`, `systemPrompt`, `source`, optional `model`, `tools`, `steps`, `timeout`, and the bb fields `provider`, `reasoning`, `permission`, `environment`, `delegate` |
| `AgentNode` | `id`, `name`, `task`, `status`, `usage`, `activityHistory`, optional `agentName`, `model`, `error` |
| `SpawnToolDetails` | `id`, `name`, `agentName`, `task`, `status`, `usage`, `finalOutput`, optional `minions` |
