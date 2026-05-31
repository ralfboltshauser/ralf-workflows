import assert from "node:assert/strict";
import {
  buildCommentPlan,
  buildAuditSubflowInput,
  extractSmithersMarkers,
  parsePatchRightLines,
} from "../components/bug-regression-audit-pr";
import type { AuditReport, Finding, PrMetadata, PullRequestFile, WorkflowInput } from "../components/bug-regression-audit-pr";

const input: WorkflowInput = {
  pr: "ralfboltshauser/example#7",
  auditMode: "quick",
  maxFindings: 10,
  checkCommands: [],
  outputDir: ".smithers/bug-regression-audit-pr-reports",
  publishMode: "dry-run",
  dedupe: true,
  postNoFindingsSummary: false,
};

const pr: PrMetadata = {
  owner: "ralfboltshauser",
  repo: "example",
  number: 7,
  url: "https://github.com/ralfboltshauser/example/pull/7",
  title: "Fixture PR",
  baseSha: "b".repeat(40),
  headSha: "a".repeat(40),
  effectiveBaseSha: "c".repeat(40),
  baseRefName: "main",
  headRefName: "feature",
  isDraft: false,
  cloneUrl: "https://github.com/ralfboltshauser/example.git",
};

const patch = `@@ -10,4 +10,5 @@ export function readUser() {
 context();
-return oldValue;
+return newValue;
 sameLine();
+addedLine();
}`;

const files: PullRequestFile[] = [
  {
    filename: "src/app.ts",
    previousFilename: null,
    status: "modified",
    patch,
  },
  {
    filename: "src/deleted.ts",
    previousFilename: null,
    status: "removed",
    patch: null,
  },
];

const finding = (id: string, path: string, line: number | null): Finding => ({
  id,
  title: `Finding ${id}`,
  severity: "high",
  confidence: "high",
  category: "correctness",
  affectedFiles: [{ path, line, symbol: null }],
  bugHypothesis: "A changed line can return the wrong value.",
  evidence: "The patch changes the return value.",
  whyThisIsNewOrRegressionRisk: "The behavior changed in this PR.",
  reproductionIdea: "Call the changed function with the previous fixture.",
  suggestedTest: "Add a regression test around the changed branch.",
  suggestedFixDirection: "Restore the previous value or adapt callers.",
});

const audit: AuditReport = {
  verdict: "bugs_found",
  summary: "Fixture audit found candidate regressions.",
  findings: [
    finding("added-line", "src/app.ts", 11),
    finding("context-line", "src/app.ts", 10),
    finding("missing-line", "src/app.ts", 99),
    finding("deleted-file", "src/deleted.ts", 1),
  ],
  discardedFindings: [],
  checksRun: [],
  coverageGaps: [],
  learnedRuleCandidates: [],
  limitations: [],
  diffBundle: {
    baseCommit: pr.effectiveBaseSha,
    headCommit: pr.headSha,
    effectiveBaseCommit: pr.effectiveBaseSha,
    files: [],
    skippedFiles: [],
    budget: {
      requestedTokens: 12_000,
      estimatedTokens: 0,
      truncated: false,
    },
  },
  confidenceSummary: {
    retained: 4,
    downgraded: 0,
    discarded: 0,
    threshold: "low",
  },
  reportPath: "/tmp/fixture.md",
};

const rightLines = parsePatchRightLines(patch);
assert.equal(rightLines.has(10), true, "context line should be anchorable");
assert.equal(rightLines.has(11), true, "added line should be anchorable");
assert.equal(rightLines.has(99), false, "missing line should not be anchorable");

const plan = buildCommentPlan(input, pr, audit, files);
assert.equal(plan.inlineComments.length, 2, "added and context lines should become inline comments");
assert.equal(plan.unanchoredFindings.length, 2, "missing and deleted-only findings should be unanchored");
assert.equal(plan.inlineComments[0]?.path, "src/app.ts");
assert.equal(plan.inlineComments[0]?.side, "RIGHT");

const markers = extractSmithersMarkers([{ body: plan.inlineComments[0]?.body }]);
assert.equal(markers.has(plan.inlineComments[0]!.dedupeKey), true, "inline comment marker should be extractable");
assert.equal(
  plan.inlineComments.filter((comment) => !markers.has(comment.dedupeKey)).length,
  1,
  "existing markers should make duplicate comments skippable",
);

const subflowInput = buildAuditSubflowInput(
  input,
  {
    status: "ready",
    checkoutPath: "/tmp/checkout",
    auditOutputDir: "/tmp/audit-output",
    effectiveBaseSha: pr.effectiveBaseSha,
    summary: "ready",
    commandsRun: [],
    limitations: [],
  },
  pr,
);
assert.equal(subflowInput.baseRef, pr.effectiveBaseSha, "PR audit should use effective merge-base as baseRef");

console.log(
  JSON.stringify(
    {
      status: "ok",
      inlineComments: plan.inlineComments.length,
      unanchoredFindings: plan.unanchoredFindings.length,
      duplicateMarkersDetected: markers.size,
    },
    null,
    2,
  ),
);
