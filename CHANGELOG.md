# [oo] pi-minion Changelog

## [Unreleased]

- feat: run minions as bb child threads when pi-minions is installed as a bb plugin. Every bb provider gets nonblocking `spawn`, `list_agents`, `list_minions`, `show_minion` and `halt`, and bb delivers each minion's answer to its parent; foreground pi sessions are unchanged outside bb. See [reference](docs/reference.md#bb-tools).
- feat: add a Minions tab, a thread header chip and a composer banner for managing a thread's minions in bb
- feat: add the bb persona fields `provider`, `reasoning`, `permission`, `environment` and `delegate`
- fix: an invalid persona file (malformed YAML or an invalid bb field) is skipped with a warning naming the file and reason, instead of breaking every named spawn; see [agents](docs/agents.md#invalid-persona-files)
- fix: a task-level `model` override now selects that model for named agents, not only for ephemeral minions
- fix: minion sessions leave out pi-minions by its package name instead of a `pi-minions` path, so a checkout or git install under another directory name no longer loads it into minions
- chore: the GitHub repository is now `kalindudc/minions`; the npm package stays `pi-minions`
- chore: reorganize the repository: the shared persona engine lives in `src/`, the pi extension in `extensions/pi/` and the bb plugin in `extensions/bb/`, with tests mirrored under `test/core/`, `test/pi/` and `test/bb/`. See [architecture](docs/architecture.md#layout).

## [0.19.0] - 2026-06-18

- feat: apply per-minion model overrides to minion sessions — resolve the spawn
  spec's `model` field against the model registry instead of using it
  display-only; accept `provider/id` and unambiguous bare ids (case-insensitive),
  fail unknown/ambiguous/unauthenticated models loudly per-minion while the rest
  of the batch proceeds, and surface per-minion error text inline in failure
  messages
- chore: spawn schema defaults to the `tasks` array

- BREAKING CHANGE: `spawn` requires a non-empty `tasks` array; top-level `task`, `agent`, and `model` are removed. One item remains a single minion; 2+ run as a parallel batch. `/spawn` is unchanged. See [reference](docs/reference.md#spawn).

## [0.18.0] - 2026-05-26

- feat: migrate pi-minions to the `@earendil-works` package ecosystem
- feat: remove background minions and acknowledgement nudges
- chore: bump transitive `fast-xml-parser` and `postcss` dependencies — @dependabot[bot]

## [0.17.0] - 2026-04-26

- feat: add `allowEphemeral` config to disable ephemeral minions — @Jomik
- feat: support `MINION.md` subfolder agents — @tunnckoCore
- fix: pass explicit pi paths to subsessions and use default tool selection for Pi 0.68+ — @tunnckoCore
- fix: wire up `AgentConfig.tools` to filter minion tool access — @Jomik
- chore: migrate from Taskfile to npm scripts

## [0.16.2] - 2026-04-17

- fix: eliminate duplicate turns in observability widget
- fix: display model labels in batch spawn and minion UI

## [0.16.1] - 2026-04-15

- fix: prevent stale child-session events from crashing parent agent
- chore: bump basic-ftp dependency

## [0.16.0] - 2026-04-11

- BREAKING CHANGE: rename `list_minions` to `list_minion_types` for listing available agent types
- feat: add `list_minions` tool to list all active minions in a session
- feat: support displayName in agent frontmatter for minion naming
- feat: persist minion activity history and fix showMinion by name
- fix: reduce default tool call threshold to 16 from 32
- refactor: extract spawn tooling into domain modules

## [0.15.0] - 2026-04-09

- feat: add foreground attach for background minions
- chore: increase default tool call threshold to 32 tool calls for the delegation reminder

## [0.14.0] - 2026-04-07

- feat: Add proxy ExtensionUIContext that forwards interactive UI calls (confirm, select, input, editor) from minion sessions to parent through EventBus, with FIFO queue serialization for concurrent requests and configurable interaction timeout to prevent TUI dialog freezing

## [0.13.0] - 2026-04-07

- feat: inherit authenticated extension tools in minion sessions
- chore(deps-dev): bump vite from 7.3.1 to 7.3.2
- chore: do not use @latest for pinned extension in the repo
- chore: drop @latest from recommended install command

## [0.12.1] - 2026-04-06

- docs: update readme and other docs to recommend pi-minions install with npm

## [0.12.0] - 2026-04-06

- feat: deliver background minion results via custom message renderer with tool-style rendering

## [0.11.0] - 2026-04-05

- feat: add configurable defaults for minion behavior with type-safe schema
- feat: support custom minion names, delegation hints, display options, and spinner frames
- feat: load settings from pi's standard config files with PI_CODING_AGENT_DIR support
- test: add comprehensive unit tests and extract shared mock context helper
- docs: document all configuration options with examples

## [0.10.2] - 2026-04-05

- fix: incorrect terminal width calculations on the batch minion renderer

## [0.10.1] - 2026-04-05

- fix: missing rendering signal for a single foreground minion when it is sent to the background

## [0.10.0] - 2026-04-05

- feat: add automated GitHub releases flow
- feat: add batch spawn tool with unified execution and agent type display
- feat: dev mode loads current extension version from repo directory
- fix: single minion rendering now skips batch rendering
- fix: footer now updates when the model is changed

## [0.9.0] - 2026-04-04

- feat: add `/minions [help|version|changelog]` subcommands
- fix: `/minions list` now shows available agent types

## [0.8.1] - 2026-04-04

- chore: add Biome linter with zero-warning enforcement and `npm run style` command
- fix: minion abort error - add completed guard to prevent post-execution onUpdate calls
- fix: usage updates when minions are in-progress
- fix: usage format in spawn-renderer
- docs: update delegation reminder with acknowledge clause

## [0.8.0] - 2026-04-03

- feat: add delegation conscience that monitors tool calls and injects delegation hints
- feat: dev UX improvements — ASCII spinner, interactive fzf model selection, cleanup script
- feat: test infrastructure — unit tests for delegation conscience, expanded e2e coverage

## [0.7.0] - 2026-04-03

- feat(observability): add non-intrusive minion activity monitoring widget with real-time streaming
- chore: add UX testing harness

## [0.6.0] - 2026-04-01

- feat: file-based subsession foundation with persistent minion sessions — replaces in-process sessions with SubsessionManager-managed file-based sessions; minions now persist with parent references, separate detach/halt signals, and explicit foreground/background tracking
- chore: update roadmap task completion status

## [0.5.2] - 2026-03-31

- fix: memory leak in result queue, logger blocking IO, progress spinner churn, background minion tool call rendering
- feat: add performance testing suite and bottleneck analysis skill
- docs: remove @latest tag recommendation, update roadmap tasks
- chore: re-organize skills and code

## [0.5.1] - 2026-03-30

- fix: /minions now behaves instantaneously when there are no foreground minions
- chore: improve minion status line, move hint from TUI banner to status line

## [0.5.0] - 2026-03-29

- feat: /minions list/show/steer commands now work instantaneously via notifications when parent session is busy, while retaining LLM-routed behavior when idle
- chore: package.json formatting

## [0.4.0] - 2026-03-29

- feat: custom footer showing combined minion + parent session token usage for complete session cost visibility
- fix: minion completion status rendering when parallel foreground minions are active
- fix: `npm run dev` plugin loading when stable version is already installed
- fix: release script now generates `package-lock.json` before committing
- chore: CHANGELOG.md formatting

## [0.3.0] - 2026-03-29

- feat: extend agent discovery to support `~/.agents/` and `.agents/` paths
- fix: tool prompt guidelines for parallel minion spawning
- docs: documentation overhaul with getting-started tutorial, architecture, contributing, and agents guides
- test: agent discovery unit tests and parallel foreground spawns e2e test
- chore: update minion name pool

## [0.2.0] - 2026-03-29

- feat: safety controls with step count and timeout for minions
- feat: config inheritance from parent sessions
- feat: agentic e2e test suite
- test: comprehensive e2e test coverage
- docs: add roadmap for v1.0.0
- chore: remove unused update-docs prompt
- chore: streamline minion name pool

## [0.1.0] - 2026-03-28

- feat: in-process minion sessions with streaming and clean abort
- feat: background mode with spawn_bg tool and auto-delivery
- feat: /minions command (list, show, bg, steer subcommands)
- feat: live detach - send foreground minions to background without interruption
- feat: steering support - inject messages into running minions mid-execution
- feat: hierarchical agent tree tracking
- feat: result queue for background minions
- feat: transcript logging per minion
- feat: /prompt release workflow for git-based releases
- feat: /prompt update-docs workflow for documentation maintenance
- fix: minion name/ID persistence on error banners
- docs: concise documentation (66% reduction - 1430→492 lines)
- docs: roadmap focused on project direction (82% reduction)
- docs: conventional commit guide
- chore: release automation with scripts/release.sh
- chore: improved minion system prompt with file creation boundaries
