# Cyber Security Audit Operator Guide

## Purpose

`cyber-security-audit` performs a defensive, report-only security review of a repository. It maps architecture, assets, CIA impact, dangerous paths, code risks, supply chain signals, CI/CD surfaces, runtime clues, and AI-generated code risks.

## Required Inputs

No input is required for a repo-local audit. By default it audits `repoPath:"."` in `standard` mode and writes a timestamped markdown report to `.smithers/audit-reports`.

## Example Runs

Quick repo-only audit:

```bash
bunx smithers-orchestrator workflow run cyber-security-audit --input '{"repoPath":".","auditMode":"quick","allowActiveScanning":false}'
```

Audit another local checkout:

```bash
bunx smithers-orchestrator workflow run cyber-security-audit --input '{"repoPath":"/path/to/project","auditMode":"quick","allowOutOfWorkspacePaths":true,"allowActiveScanning":false}'
```

Include recent commit-history context:

```bash
bunx smithers-orchestrator workflow run cyber-security-audit --input '{"repoPath":".","auditMode":"standard","scanCommitHistorySince":"2 months ago","allowActiveScanning":false}'
```

Allow conservative active checks only for an authorized target:

```bash
bunx smithers-orchestrator workflow run cyber-security-audit --input '{"repoPath":".","auditMode":"standard","targetUrl":"https://example.com","allowActiveScanning":true}'
```

## Important Inputs

- `repoPath`: repository to audit. Defaults to `"."`.
- `auditMode`: `quick`, `standard`, or `deep`. Defaults to `standard`.
- `outputDir`: report directory. Defaults to `.smithers/audit-reports`.
- `allowOutOfWorkspacePaths`: required when `repoPath` or `outputDir` resolves outside the workflow workspace.
- `priorityAttackVectors`, `focusAreas`, `repositoryContext`, `appProfile`: optional scoping hints.
- `scanCommitHistorySince`: include recent git history context, such as `"2 months ago"`.
- `validationConcurrency`: finding validation concurrency from `1` to `4`. Defaults to `2`.
- `targetUrl` plus `allowActiveScanning:true`: permits conservative active checks for that URL only.

## What It Does

- Enforces scope and path guardrails before audit work starts.
- Runs read-only Codex review phases for intake, asset mapping, threat modeling, evidence collection, manual review, validation, and report writing.
- Records missing optional scanner tools instead of installing them.
- Separates proven or likely findings from scanner leads, limitations, and external inspection needs.
- Writes a unique `audit-report-<UTC timestamp>-<run id>.md` file under `outputDir`, so repeated runs do not overwrite earlier reports.

## Safety Defaults

- Agent phases use a read-only Codex sandbox.
- The audited repository is not edited.
- Active network scanning is disabled unless both `allowActiveScanning:true` and a valid `targetUrl` are provided.
- The intended write is only the final markdown report.
- Secret values are redacted in the final report, but avoid auditing repos that contain live committed secrets.

## Failure and Retry Behavior

If the audit is weak or inconclusive, rerun with clearer `focusAreas`, `repositoryContext`, or `scanCommitHistorySince`. If path validation fails, either run from the target workspace or set `allowOutOfWorkspacePaths:true` intentionally.
