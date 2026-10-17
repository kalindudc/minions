# Architecture

pi-minions runs minions in two places: a pi extension runs them as foreground sessions inside pi, and a bb plugin runs them as bb child threads. Both read the same personas through one shared core.

## Layout

| Root | Contains | Imports |
|---|---|---|
| `src/` | Core engine: persona discovery, parsing and validation, persona-file checks, the persona types and the minion name pool | Node built-ins, `yaml` and other core files only |
| `extensions/pi/` | pi extension: foreground minion sessions, tools, commands and TUI | Core and pi packages |
| `extensions/bb/` | bb plugin: child-thread minions, RPC, agent tools, the Minions tab, its skill and vendored UI | Core, the bb SDK and UI packages |

The two extensions never import each other, not even for types, so either can change without touching the other. `test/layout.test.ts` enforces these rules. Tests mirror the roots under `test/core/`, `test/pi/` and `test/bb/`.

One `package.json` serves both hosts, because pi and bb each read the repository root when they install from git. `pi.extensions` points at `extensions/pi/index.ts`; `bb.server`, `bb.app` and `bb.skills` point into `extensions/bb/`. Keep `extensions/bb/` free of an `index.ts`: pi falls back to loading `extensions/*/index.ts` by convention if its manifest entry ever disappears.

## Core modules

| Module | Purpose |
|---|---|
| `src/agents.ts` | Discovers personas in the eight user and project locations, with project personas overriding user ones; validates the bb persona fields and skips invalid files with a warning; checks that a persona path resolves into a directory discovery reads for the thread, and reads persona bodies |
| `src/minion-names.ts` | The built-in minion name pool that pi and bb both draw names from |
| `src/persona-frontmatter.ts` | Parses frontmatter and resolves the pi agent directory exactly as pi 1.2.0 does, without loading pi |
| `src/types.ts` | `AgentConfig` and the other persona types |

## pi extension modules

| Module | Purpose |
|---|---|
| `extensions/pi/index.ts` | Registers tools, commands, renderer, session hooks, status/footer wiring |
| `extensions/pi/bb-bridge.ts` | Detects when bb supplies the minion tools so the extension [steps aside](reference.md#pi-inside-bb) |
| `extensions/pi/tools/spawn.ts` | Public foreground `spawn` tool and batch orchestration setup |
| `extensions/pi/spawn.ts` | Runs one minion session and enforces internal step/timeout safety |
| `extensions/pi/spawn/batch.ts` | Aggregates foreground minion status, output, usage, and render updates |
| `extensions/pi/spawn/runner.ts` | Runs a single foreground minion inside a batch coordinator |
| `extensions/pi/tools/minions.ts` | `list_minions` and `show_minion` text surfaces |
| `extensions/pi/tools/halt.ts` | Abort path for running minions |
| `extensions/pi/commands/*.ts` | User slash commands |
| `extensions/pi/subsessions/manager.ts` | File-based minion session lifecycle, metadata, progress events |
| `extensions/pi/subsessions/event-bus.ts` | Lightweight event bus for progress and completion events |
| `extensions/pi/subsessions/observability.ts` | Live activity widget for foreground minions |
| `extensions/pi/status.ts` | Foreground minion status line and hints |
| `extensions/pi/tree.ts` | In-memory minion hierarchy, status, usage, and activity |
| `extensions/pi/skill.ts` | Packaged usage guidance returned by learn surfaces |

## bb plugin modules

| Module | Purpose |
|---|---|
| `extensions/bb/server.ts` | Plugin entry: RPC contract, the five agent tools and per-thread tool selection |
| `extensions/bb/metadata.ts` | The minion metadata schema stored on each child thread, and the check that a thread is one of this plugin's minions |
| `extensions/bb/personality.ts` | Personality traits and their instruction sentence, and the choice of a minion's name |
| `extensions/bb/spawn.ts` | Spawns child threads: persona, provider, model, reasoning, permission, environment and delegation depth |
| `extensions/bb/state.ts` | Lists a thread's minions, checks ownership, stops, archives and messages them, and publishes live updates |
| `extensions/bb/app.tsx` | Frontend entry: Minions tab, the composer's Minions button and the sidebar's goggles tag |
| `extensions/bb/skills/minions/` | Guidance bb gives agents for nonblocking delegation |
| `extensions/bb/components/`, `hooks/`, `lib/`, `components.json` | UI controls vendored from the bb scaffold, excluded from Biome so they stay close to the registry copies |

The plugin's RPC methods trust the thread id in their input, because bb's RPC context does not identify the calling thread; an agent could call them with `bb plugin rpc call`, which grants nothing beyond what the bb CLI already allows.

## Data flow in pi

1. Parent calls [`spawn`](reference.md#spawn) or `/spawn` directs the parent to call it.
2. `extensions/pi/tools/spawn.ts` validates the `tasks` array, resolves each entry's named or ephemeral agent config, creates tree nodes, and starts a `BatchCoordinator`.
3. Each minion is run through `runSingleMinion()` and `runMinionSession()`.
4. `SubsessionManager` creates a file-backed pi agent session, filters recursive extension loading, binds extensions, tracks metadata, and emits progress events.
5. Progress callbacks update `AgentTree`; renderers/status/observability read from that tree.
6. The foreground tool call returns final output and usage when all minions finish, fail, or are halted.

In bb, `spawn` instead creates child threads and returns at once; see [spawn in bb](reference.md#spawn-in-bb).

## Foreground visibility

Foreground visibility is intentionally retained after slimming the package:

- `AgentTree` stores running and completed minion state for the current parent session.
- `list_minions` summarizes tree state.
- `show_minion` formats detailed status, usage, and recent activity.
- `/minions` opens a live widget for running minions.
- `EventBus` carries progress/completion events from subsessions to the observability widget.
- `status.ts` shows active foreground minion count and lightweight hints.

## Safety controls

User-facing steering is not public. Internal safety steering remains inside `extensions/pi/spawn.ts` so step limits and timeouts can ask a minion to wrap up before force-aborting.

## Packaging

The published npm tarball includes the core (`src/`) and the pi extension (`extensions/pi/`) plus npm always-included metadata files. The bb plugin installs from git or a local path and is not in the tarball. User-facing docs live in the repository and are intentionally omitted from the package tarball.
