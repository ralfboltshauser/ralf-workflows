import assert from "node:assert/strict";
import {
  applyConfidenceScoring,
  buildDiffBundle,
  parseUnifiedDiff,
} from "../components/bug-regression-audit";
import type {
  CheckEvidence,
  DiffIntake,
  EffectiveAuditConfig,
  ValidationReport,
} from "../components/bug-regression-audit";

const patch = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
 export function readUser(cache, userId) {
-  return cache.get(userId) ?? null;
+  return cache.get("current") ?? null;
 }
diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,2 +1,2 @@
-export const name = "old";
+export const name = "new";
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
--- a/src/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const removed = true;
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ`;

const config: EffectiveAuditConfig = {
  configPath: "/tmp/bug-regression-audit.config.json",
  configLoaded: true,
  ignoreGlobs: ["ignored/**"],
  ignoreRegexes: [],
  generatedGlobs: ["bun.lock", "**/*.snap"],
  projectRules: ["Prefer user-id keyed cache lookups."],
  auditMode: "quick",
  includeGenerated: false,
  maxDiffTokens: 12_000,
  contextLines: 6,
  minConfidence: "medium",
  limitations: [],
};

const changedFiles: DiffIntake["changedFiles"] = [
  {
    path: "src/app.ts",
    oldPath: null,
    status: "M",
    additions: 1,
    deletions: 1,
    generated: false,
    skipped: false,
    skipReason: null,
  },
  {
    path: "src/new.ts",
    oldPath: "src/old.ts",
    status: "R080",
    additions: 1,
    deletions: 1,
    generated: false,
    skipped: false,
    skipReason: null,
  },
  {
    path: "src/deleted.ts",
    oldPath: null,
    status: "D",
    additions: 0,
    deletions: 1,
    generated: false,
    skipped: false,
    skipReason: null,
  },
  {
    path: "assets/logo.png",
    oldPath: null,
    status: "M",
    additions: 0,
    deletions: 0,
    generated: false,
    skipped: false,
    skipReason: null,
  },
  {
    path: "bun.lock",
    oldPath: null,
    status: "M",
    additions: 5,
    deletions: 2,
    generated: false,
    skipped: false,
    skipReason: null,
  },
];

const parsed = parseUnifiedDiff(patch);
assert.equal(parsed.get("src/app.ts")?.hunks[0]?.newSideLines.some((line) => line.line === 2 && line.kind === "added"), true);
assert.equal(parsed.get("src/new.ts")?.oldPath, "src/old.ts");

const { bundle, changedFiles: annotated } = buildDiffBundle(
  changedFiles,
  patch,
  config,
  "b".repeat(40),
  "h".repeat(40),
  "m".repeat(40),
);

assert.equal(bundle.files.some((file) => file.path === "src/app.ts"), true);
assert.equal(bundle.files.some((file) => file.path === "src/new.ts"), true);
assert.equal(bundle.skippedFiles.some((file) => file.path === "assets/logo.png" && file.reason.includes("binary")), true);
assert.equal(bundle.skippedFiles.some((file) => file.path === "bun.lock" && file.reason.includes("generated")), true);
assert.equal(annotated.find((file) => file.path === "bun.lock")?.skipped, true);

const intake: DiffIntake = {
  repoPath: "/tmp/repo",
  repoRoot: "/tmp/repo",
  currentBranch: "main",
  upstreamRef: "origin/main",
  requestedBaseRef: "main",
  requestedHeadRef: "HEAD",
  resolvedBaseRef: "main",
  resolvedBaseCommit: bundle.baseCommit,
  resolvedHeadRef: "HEAD",
  resolvedHeadCommit: bundle.headCommit,
  baseResolution: "merge-base:main",
  baselineStatus: "resolved",
  includeUncommitted: false,
  hasUncommittedChanges: false,
  untrackedFiles: [],
  changedFiles: annotated,
  auditConfig: config,
  diffBundle: bundle,
  diffSummary: "",
  unifiedDiff: patch,
  diffTruncated: false,
  commandsRun: [],
  limitations: [],
};

const checks: CheckEvidence = {
  summary: "No checks",
  commandsRun: [],
  skippedCommands: [],
  limitations: [],
};

const validation: ValidationReport = {
  verdict: "bugs_found",
  summary: "Fixture validation",
  findings: [
    {
      id: "good-001",
      title: "Cache lookup ignores requested user",
      severity: "high",
      confidence: "high",
      category: "correctness",
      affectedFiles: [{ path: "src/app.ts", line: 2, symbol: "readUser" }],
      bugHypothesis: "The function always reads the current cache key instead of the requested user.",
      evidence: "The new right-side line returns cache.get(\"current\") while the function still accepts userId.",
      whyThisIsNewOrRegressionRisk: "The changed line replaces userId with a constant cache key in this diff.",
      reproductionIdea: "Populate two user cache entries and call readUser with the non-current user id.",
      suggestedTest: "Assert readUser(cache, \"other\") returns the other user's cached value.",
      suggestedFixDirection: "Use cache.get(userId) or update callers and tests if the contract intentionally changed.",
    },
    {
      id: "weak-001",
      title: "Unanchored concern",
      severity: "medium",
      confidence: "medium",
      category: "correctness",
      affectedFiles: [{ path: "src/app.ts", line: 99, symbol: null }],
      bugHypothesis: "Something might be wrong.",
      evidence: "Thin evidence.",
      whyThisIsNewOrRegressionRisk: "Thin reasoning.",
      reproductionIdea: "",
      suggestedTest: "Add a test.",
      suggestedFixDirection: "Fix it.",
    },
  ],
  discardedFindings: [],
  coverageGaps: [],
  learnedRuleCandidates: [],
  limitations: [],
};

const scored = applyConfidenceScoring(validation, intake, checks);
assert.equal(scored.validation.findings.length, 1);
assert.equal(scored.summary.discarded, 1);
assert.equal(scored.summary.threshold, "medium");

console.log(
  JSON.stringify(
    {
      status: "ok",
      reviewedFiles: bundle.files.length,
      skippedFiles: bundle.skippedFiles.length,
      retainedFindings: scored.validation.findings.length,
    },
    null,
    2,
  ),
);
