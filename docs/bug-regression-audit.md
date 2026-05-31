# Bug Regression Audit Operator Guide

## Purpose

`bug-regression-audit` reviews a local git diff for likely accidental bugs. It is for catching regressions before merge, not for broad style review or planned refactoring.

## Required Inputs

Run it from a git repository or provide `repoPath`. If the workflow cannot infer a baseline from the branch upstream, `origin/main`, or `main`, provide `baseRef`.

## Example Runs

Quick audit of the current branch and uncommitted changes:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit --input '{"repoPath":".","baseRef":"origin/main","headRef":"HEAD","includeUncommitted":true,"auditMode":"quick"}'
```

Deeper audit with extra validation commands:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit --input '{"repoPath":".","baseRef":"origin/main","headRef":"HEAD","auditMode":"deep","checkCommands":["bun test","bun run typecheck"]}'
```

## Important Inputs

- `repoPath`: repository to inspect. Defaults to `"."`.
- `baseRef`: baseline ref. Optional, but recommended for reproducible results.
- `headRef`: head ref to audit. Defaults to `"HEAD"`.
- `includeUncommitted`: include working tree changes for HEAD-based audits. Defaults to `true`.
- `auditMode`: `quick`, `standard`, or `deep`. Defaults to `standard`.
- `checkCommands`: extra read/verification commands to run after `git diff --check`.
- `outputDir`: report directory. Defaults to `.smithers/bug-regression-audit-reports`.
- `maxFindings`, `ignoreGlobs`, `ignoreRegexes`, `includeGenerated`, `minConfidence`: tune review scope and output volume.

Optional project defaults can live in `.smithers/bug-regression-audit.config.json`.

## What It Does

- Builds a structured diff bundle from the selected base/head range.
- Runs configured validation commands and records their results.
- Uses specialist review passes for correctness, API contracts, state/data, async/concurrency, permissions, and test gaps.
- Produces evidence-backed findings with severity, confidence, affected files, reproduction ideas, and suggested tests.
- Writes a markdown report to `outputDir/bug-regression-audit.md`.

## Approval and Side Effects

No human approval is required. The workflow does not edit source files or publish comments. Its intended write is the markdown report under `outputDir`.

## Failure and Retry Behavior

If the result is inconclusive, rerun with an explicit `baseRef` and any project-specific `checkCommands`. If the diff is very large, use `ignoreGlobs`, `maxDiffTokens`, or `auditMode:"quick"` to reduce scope.
