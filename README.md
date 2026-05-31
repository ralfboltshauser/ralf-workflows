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
npx smithers-directory add ralfboltshauser/ralf-workflows@bug-regression-audit
npx smithers-directory add ralfboltshauser/ralf-workflows@lighthouse-check
npx smithers-directory add ralfboltshauser/ralf-workflows@bug-regression-audit-pr
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

Run the bug regression audit workflow against a local diff:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit --input '{"repoPath":".","baseRef":"HEAD~1","headRef":"HEAD","includeUncommitted":true,"auditMode":"quick"}'
```

The CLI final `output` contains the structured audit report, and the same result is written as markdown under `outputDir`.
The audit understands optional `.smithers/bug-regression-audit.config.json` project defaults for ignore globs, generated-file globs, project rules, and confidence thresholds.

Run the bug regression audit PR wrapper in dry-run mode:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit-pr --input '{"pr":"https://github.com/OWNER/REPO/pull/123","auditMode":"quick","publishMode":"dry-run"}'
```

The PR wrapper prepares inline-ready comments by default. It only posts to GitHub when `publishMode` is explicitly set to `summary-comment` or `review`.
For PRs, the wrapper computes the effective merge base in a temporary checkout and passes that baseline into the underlying audit workflow.

Run the external-repo smoke fixture:

```bash
cd .smithers
bun run smoke:bug-regression-audit-core
bun run smoke:bug-regression-audit
bun run smoke:bug-regression-audit-pr
cd ..
```

Run a Lighthouse check workflow against an already-running local app:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --run-id lighthouse-local-check --input '{"repoPath":"/path/to/app","localUrl":"http://localhost:3000","routes":["/"],"numberOfRuns":1,"allowImplementation":false}'
```

Run with LHCI starting the local server:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --run-id lighthouse-next-check --input '{"repoPath":"/path/to/next-app","buildCommand":"npm run build","localServeCommand":"npm run start","localUrl":"http://localhost:3000","routes":["/"],"numberOfRuns":3}'
```

Add an optional production comparison only when authorized:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --run-id lighthouse-prod-context --input '{"repoPath":"/path/to/app","localUrl":"http://localhost:3000","prodUrl":"https://example.com","allowProdCheck":true,"routes":["/"],"numberOfRuns":3}'
```

The workflow writes `.smithers/lighthouse-reports/final-report.md` inside the audited repo. That report is itself reviewed and revised in a bounded two-iteration loop before publication.

Current `lighthouse-check` scope:

- Always runs a local Lighthouse baseline.
- Optionally runs a production baseline when `prodUrl` and `allowProdCheck` are provided.
- Reviews Lighthouse artifacts and available repository context.
- Produces a reviewed remediation report with bounded plan-review and final-report-review passes.
- Supports implementation-mode inputs, but the published workflow should currently be treated as an audit/report workflow until implementation-mode smoke coverage is expanded.

Common inputs:

- `repoPath`: repository or fixture path to audit; defaults to `.`.
- `localUrl`: local or reachable URL for the required local baseline; defaults to `http://localhost:3000`.
- `buildCommand` / `localServeCommand`: optional commands for production-like local checks.
- `prodUrl` / `allowProdCheck`: optional production context.
- `routes`: routes to audit; defaults to `["/"]`.
- `numberOfRuns`: Lighthouse runs per target; defaults to `5`.
- `allowImplementation`: set `false` for report-only audits.

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
