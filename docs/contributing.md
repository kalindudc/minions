# Contributing

## Setup

```bash
npm install
```

The [Develop](../README.md#develop) section of the README covers the bb and pi development loop.

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Load the extension into pi in debug mode |
| `npm test` | Run unit tests |
| `npm run test:json` | Run unit tests with JSON output |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run style:check` | Check formatting/lint style |
| `npm run test:e2e` | Run agentic e2e specs |
| `bb plugin build .` | Build the bb plugin bundles into `dist/` |

Use npm: CI runs `npm ci`, and `package-lock.json` is the lockfile that is kept current.

## Project structure

```text
src/                    # core engine both extensions share
  agents.ts             # persona discovery, parsing and file checks
  persona-frontmatter.ts
  types.ts              # persona types

extensions/
  pi/                   # pi extension (pi.extensions)
    index.ts            # extension registration
    tools/              # LLM-callable tools
    commands/           # slash commands
    spawn.ts            # minion session orchestration
    spawn/              # batch and single-run helpers
    subsessions/        # file-based minion session lifecycle and observability
    renderers/          # spawn renderer
    status.ts           # status line hints
    tree.ts             # minion state tree
    skill.ts            # built-in learn/skill text
  bb/                   # bb plugin (bb.server, bb.app, bb.skills)
    server.ts           # RPC, agent tools and tool selection
    spawn.ts            # child-thread spawning
    state.ts            # minion listing and actions
    app.tsx             # Minions tab, header chip and banner
    skills/minions/     # bb agent skill
    components/ hooks/ lib/ components.json   # vendored bb UI

test/
  core/                 # mirrors src/
  pi/                   # mirrors extensions/pi/, plus helpers/, e2e/ and perf/
  bb/                   # mirrors extensions/bb/, plus helpers/
  layout.test.ts        # dependency rule and manifest entries
```

See [Architecture](architecture.md#layout) for what each root may import.

## Standards

- TypeScript strict mode must pass.
- Tests should verify observable behavior rather than implementation details.
- Prefer simple vertical changes over broad abstractions.
- Do not add runtime dependencies without a clear need.
- User-facing docs live in `docs/`; the npm tarball intentionally excludes repository docs.

## Validation before review

```bash
npm run test:json
npm run typecheck
npm run style:check
bb plugin build .
npm pack --dry-run
```

Confirm the package dry run does not include repository docs or the changelog file.
