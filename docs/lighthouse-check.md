# Lighthouse Check Operator Guide

## Purpose

`lighthouse-check` runs Lighthouse against a local web app, optionally compares a production URL, reviews the codebase, and writes a remediation report.

## Required Inputs

The workflow needs a local target. Provide one of:

- `localUrl` for an already-running app. Defaults to `http://localhost:3000`.
- `localServeCommand` to start the app.
- `staticDistDir` for a static build output.

If `localUrl` is not reachable and no runtime command is available, the workflow asks for local runtime details.

## Example Runs

Report-only check against an already-running local app:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --input '{"repoPath":".","localUrl":"http://localhost:3000","routes":["/"],"numberOfRuns":3,"allowImplementation":false}'
```

Let the workflow build and start a production-like local server:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --input '{"repoPath":".","buildCommand":"npm run build","localServeCommand":"npm run start","localUrl":"http://localhost:3000","routes":["/"],"numberOfRuns":3,"allowImplementation":false}'
```

Add production context only when authorized:

```bash
bunx smithers-orchestrator workflow run lighthouse-check --input '{"repoPath":".","localUrl":"http://localhost:3000","prodUrl":"https://example.com","allowProdCheck":true,"routes":["/"],"numberOfRuns":3,"allowImplementation":false}'
```

## Important Inputs

- `repoPath`: project path. Defaults to `"."`.
- `routes`: route paths or URLs to audit. Defaults to `["/"]`.
- `numberOfRuns`: Lighthouse runs per target. Defaults to `5`, max `7`.
- `formFactors`: `mobile` and/or `desktop`. Defaults to `["mobile"]`.
- `categories`: Lighthouse categories. Defaults to performance, accessibility, best-practices, and SEO.
- `prodUrl` plus `allowProdCheck:true`: optional production comparison.
- `allowImplementation`: if `true`, the workflow may attempt scoped code changes. Set `false` for report-only use.
- `approvalMode`: `auto`, `always`, or `never`. Controls human approval before implementation.
- `outputDir`: report and artifact directory. Defaults to `.smithers/lighthouse-reports`.

## What It Does

- Runs local Lighthouse baselines serially to reduce measurement noise.
- Optionally runs production baselines when explicitly authorized.
- Parses Lighthouse artifacts and reviews relevant codebase context.
- Produces a remediation plan and a reviewed final report.
- Writes `.smithers/lighthouse-reports/final-report.md` by default.

## Approval and Side Effects

With `allowImplementation:false`, the workflow is report-only. With `allowImplementation:true`, it may edit the audited repo after its plan gate and approval policy allow it.

## Failure and Retry Behavior

Most failures come from an unreachable local app, missing build/start commands, Chrome/Lighthouse runtime issues, or unstable routes. Rerun with explicit `localServeCommand`, fewer `routes`, and `numberOfRuns:1` for a quick diagnosis.
