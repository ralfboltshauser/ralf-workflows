# Ralf Smithers Workflows

Public Smithers workflow workspace and directory-publishable workflow pack.

## Directory Publishing

This repo publishes workflows through [smithers.directory](https://www.smithers.directory/) with the root `smithers-directory.json` manifest. The manifest is the publishing contract and should list only authored Ralf workflows.

Install the full published pack:

```bash
npx smithers-directory add ralfboltshauser/ralf-workflows
```

Install one workflow with:

```bash
npx smithers-directory add ralfboltshauser/ralf-workflows@hello-world
```

## Layout

- `.smithers/workflows/` contains runnable Smithers workflows.
- `.smithers/package.json` and `.smithers/bun.lock` define the local Smithers runtime dependencies.
- `.smithers/agents.ts` maps workflow agent slots to Codex.
- `smithers-directory.json` lists only workflows intended for public installation.

## Setup

Install runtime dependencies:

```bash
cd .smithers
bun install
cd ..
```

Run Smithers commands from the repo root.

List available workflows:

```bash
bunx smithers-orchestrator workflow list
```

Run the Hello World workflow:

```bash
bunx smithers-orchestrator up .smithers/workflows/hello-world.tsx --run-id hello-world-check
```

## Authoring Flow

1. Create a workflow in `.smithers/workflows/`.
2. Add the workflow to `smithers-directory.json`.
3. Typecheck from `.smithers`:

```bash
cd .smithers
bun run typecheck
cd ..
```

4. Run the workflow locally from the repo root.
5. Commit, push, and test installation with `npx smithers-directory add ralfboltshauser/ralf-workflows@workflow-name`.

Smithers stores generated runtime state in ignored paths such as `executions/`, `runs/`, `sandboxes/`, `state/`, logs, and local SQLite databases.
