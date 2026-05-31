# Bug Regression Audit PR Operator Guide

## Purpose

`bug-regression-audit-pr` runs the local bug regression audit against a GitHub pull request and prepares PR-ready review comments.

## Required Inputs

- `pr`: a GitHub PR URL like `https://github.com/OWNER/REPO/pull/123` or shorthand `OWNER/REPO#123`.
- GitHub CLI `gh` must be installed and authenticated for PR metadata, clone, file lookup, and publishing.

## Example Runs

Dry-run mode. This prepares comments and writes reports without posting to GitHub:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit-pr --input '{"pr":"https://github.com/OWNER/REPO/pull/123","auditMode":"quick","publishMode":"dry-run"}'
```

Publish a single summary comment:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit-pr --input '{"pr":"OWNER/REPO#123","auditMode":"standard","publishMode":"summary-comment"}'
```

Publish a PR review with inline comments where GitHub accepts anchors:

```bash
bunx smithers-orchestrator workflow run bug-regression-audit-pr --input '{"pr":"OWNER/REPO#123","auditMode":"standard","publishMode":"review"}'
```

## Important Inputs

- `auditMode`: `quick`, `standard`, or `deep`. Defaults to `standard`.
- `publishMode`: `dry-run`, `summary-comment`, or `review`. Defaults to `dry-run`.
- `checkCommands`: extra commands passed into the underlying audit workflow.
- `outputDir`: report directory. Defaults to `.smithers/bug-regression-audit-pr-reports`.
- `checkoutDir`: optional parent directory for the temporary PR checkout.
- `dedupe`: skip comments with existing Smithers markers. Defaults to `true`.
- `postNoFindingsSummary`: post a summary even when no findings are found. Defaults to `false`.

## What It Does

- Resolves PR metadata through `gh api`.
- Creates a temporary checkout and computes an effective merge base.
- Runs `bug-regression-audit` against the PR head.
- Maps findings to PR changed files and prepares inline comments when possible.
- Writes a PR report under `outputDir`.

## Approval and Publishing

`dry-run` never posts to GitHub. `summary-comment` and `review` post comments using the authenticated `gh` user. Review output is deduplicated by Smithers markers unless `dedupe:false` is provided.

## Failure and Retry Behavior

Failures usually come from missing `gh` auth, clone/fetch problems, missing PR permissions, or GitHub rejecting inline anchors. If inline review creation fails, the workflow falls back to summary-style output when possible.
