# AGENTS

pi-minions adds recursive subagent orchestration (minions) to pi and to bb. A pi extension (`extensions/pi/index.ts`) runs minions as isolated in-process agent sessions, and a bb plugin (`extensions/bb/`) runs them as bb child threads.

## Architecture

The repository has three roots. `src/` is the core engine both extensions share (persona discovery, parsing and checks). `extensions/pi/` is the pi extension, which stays foreground-only with no result queue. `extensions/bb/` is the bb plugin, with its skill and vendored UI. Core imports neither pi nor bb, the extensions never import each other, and tests mirror the roots under `test/core/`, `test/pi/` and `test/bb/`. The layout rules, module map, data flow and design decisions live in [Architecture](docs/architecture.md).

## Development

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps, verify toolchain (runs `prepare`) |
| `npm run dev` | Load extension into pi (debug mode) |
| `npm test` | Run unit tests (vitest) |
| `npm run test:json` | Run unit tests with JSON output (for parsing) |
| `npm run typecheck` | TypeScript type check |
| `npm run style:check` | Biome lint and format check of `src/`, `extensions/` and `test/` (vendored bb UI excluded) |
| `bb plugin build .` | Build the bb plugin bundles into `dist/`; needs no running bb |
| `npm run test:e2e` | Run agentic e2e tests |

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Key conventions

- TypeScript strict (`tsc --noEmit` must pass)
- vitest for unit tests, agentic markdown tests for e2e
- No JSDoc — types are the documentation
- Flat `docs/` directory, no nesting
- Documentation - each concept lives in exactly one file
- Cross-reference between docs, never duplicate content
- Do NOT mix quadrants in a single doc file

## Testing

Always load `/skill:test-writer` before writing or auditing tests and follow it's guidance.

If any test run parsing tools area available, ALWAYS pass it raw JSON output with `npm run test:json` and then use the tool to parse the output

Install dependencies with `npm ci --ignore-scripts` when you must not run `prepare` (it changes git hooks and creates symlinks).

Live bb checks change the user's bb: only with permission, install with `bb plugin install path:<checkout>`, iterate with `bb plugin dev <checkout>`, and test from a separate bb thread, never the thread doing the work.

## Documentation

- [Getting started](docs/getting-started.md) — tutorial walkthrough
- [Patterns](docs/patterns.md) — how-to recipes
- [Agents](docs/agents.md) — agent creation and configuration
- [Reference](docs/reference.md) — tool/command schemas and types
- [Architecture](docs/architecture.md) — module map, data flow, design decisions
- [Configuration](docs/configuration.md) — global and project settings
- [Contributing](docs/contributing.md) — dev setup, testing, release
- [E2E testing](docs/e2e-testing.md) — writing agentic tests
- [Roadmap](docs/roadmap.md) — current foreground-only work

## Do NOT

- Edit generated files or `node_modules/`
- Duplicate content across doc files — link instead
- Mix documentation quadrants (tutorial/how-to/reference/explanation) in a single file
- Reference `tmp/research/` from user-facing docs (internal only)
