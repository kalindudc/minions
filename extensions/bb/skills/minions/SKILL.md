---
name: minions
description: Delegate to bb child threads. Use when independent tasks can run in parallel as minion threads, or when a task needs its own persona, model or worktree.
---

# Minions in bb

In bb, a minion is a child thread of the current thread. `spawn` creates the threads and returns at once; it does NOT wait for them to finish. bb nests each minion under this thread and reports back to this thread on its own:

- bb delivers an answer only for a minion that completed, and cuts that answer at 4,000 characters.
- A failed or interrupted minion, or one that needs help, arrives as a status notice without an answer.
- A minion that you or the user stop, with `halt` or from the Minions tab, sends no report.
- Reports that arrive within about 2 seconds of each other arrive as one list without answers.
- `show_minion` returns the full answer of any minion.

## Tools

| Tool | Use |
| --- | --- |
| `list_agents` | List the personas you can name in a task's `agent` field. |
| `spawn` | Start one to eight minions: `{ "tasks": [{ "task": "...", "agent": "...", "model": "...", "environment": "shared" }] }`. Only `task` is required. |
| `list_minions` | List this thread's minions with their status, model and quest progress. |
| `show_minion` | Read one minion's status and full final answer: `{ "id": "<minion thread id>" }`. |
| `halt` | Stop one minion with `{ "id": "<minion thread id>" }`, or every running minion with `{ "id": "all" }`. |

## Procedure

1. Run `list_agents` when you are unsure which personas exist. Omit `agent` to start a general-purpose minion.
2. Write each `task` so it stands alone. A minion has none of your conversation, so include file paths, constraints and the shape of the answer you want.
3. Leave `model` out to use the persona's model or this thread's model. A `model` must be an exact model id or a unique suffix after `/`.
4. Use `environment: "worktree"` only when a minion edits files that other work also touches. The default, `shared`, works in this thread's checkout.
5. Call `spawn` once with every independent task. Read the line it returns for each task: it names the minion's thread id and model, or the error for that task alone. Fix and retry only the failed tasks.
6. Continue with other work, or end your turn. NEVER poll `list_minions` or `show_minion` while you wait: bb reports each minion to this thread on its own.
7. When a report arrives, run `show_minion` for the minions you need the full answer of: when the delivered answer was cut short, when several minions arrived as one list, or when a minion failed, was interrupted or needs help.

## Rules

- Each minion is a real thread. The user can open, message, stop and archive it from the Minions tab.
- A minion may start its own minions only when its persona sets `delegate: true`, and never more than two levels deep.
- An unknown persona, a model that matches nothing or more than one model, or an unsupported reasoning level fails only its own task, and the error lists the valid choices.
- When the user stops a minion, do NOT start it again unless the user asks.
