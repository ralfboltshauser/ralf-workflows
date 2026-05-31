import { z } from "zod/v4";

export const auditModes = ["quick", "standard", "deep"] as const;
export const verdicts = ["bugs_found", "no_clear_bugs", "inconclusive"] as const;
export const severities = ["critical", "high", "medium", "low"] as const;
export const confidences = ["high", "medium", "low"] as const;
export const categories = [
  "correctness",
  "api-contract",
  "state-data",
  "async-concurrency",
  "security-permissions",
  "test-gap",
  "unknown",
] as const;

export const stringList = z.array(z.string());

export const feedbackSchema = z.object({
  acceptedFindingIds: stringList.default([]),
  dismissedFindingIds: stringList.default([]),
  missedBugNotes: stringList.default([]),
  ruleEdits: stringList.default([]),
});

export const workflowInputSchema = z.object({
  repoPath: z.string().default("."),
  baseRef: z.string().optional(),
  headRef: z.string().default("HEAD"),
  includeUncommitted: z.boolean().default(true),
  auditMode: z.enum(auditModes).default("standard"),
  maxFindings: z.number().int().positive().default(10),
  outputDir: z.string().default(".smithers/bug-regression-audit-reports"),
  checkCommands: stringList.default([]),
  configPath: z.string().optional(),
  ignoreGlobs: stringList.default([]),
  ignoreRegexes: stringList.default([]),
  includeGenerated: z.boolean().default(false),
  maxDiffTokens: z.number().int().positive().optional(),
  contextLines: z.number().int().nonnegative().optional(),
  minConfidence: z.enum(confidences).default("low"),
  feedback: feedbackSchema.optional(),
});

export const auditConfigSchema = z.object({
  ignoreGlobs: stringList.default([]),
  ignoreRegexes: stringList.default([]),
  generatedGlobs: stringList.default([]),
  projectRules: stringList.default([]),
  defaultAuditMode: z.enum(auditModes).optional(),
  minConfidence: z.enum(confidences).default("low"),
});

export const effectiveAuditConfigSchema = z.object({
  configPath: z.string(),
  configLoaded: z.boolean(),
  ignoreGlobs: stringList,
  ignoreRegexes: stringList,
  generatedGlobs: stringList,
  projectRules: stringList,
  auditMode: z.enum(auditModes),
  includeGenerated: z.boolean(),
  maxDiffTokens: z.number().int().positive(),
  contextLines: z.number().int().nonnegative(),
  minConfidence: z.enum(confidences),
  limitations: stringList,
});

export const fileRefSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().nullable(),
  symbol: z.string().nullable(),
});

export const findingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(severities),
  confidence: z.enum(confidences),
  category: z.enum(categories),
  affectedFiles: z.array(fileRefSchema),
  bugHypothesis: z.string(),
  evidence: z.string(),
  whyThisIsNewOrRegressionRisk: z.string(),
  reproductionIdea: z.string(),
  suggestedTest: z.string(),
  suggestedFixDirection: z.string(),
});

export const discardedFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  reasonDiscarded: z.string(),
  originalCategory: z.enum(categories).nullable(),
});

export const checkResultSchema = z.object({
  command: z.string(),
  purpose: z.string(),
  result: z.enum(["passed", "failed", "skipped", "not_run"]),
  exitCode: z.number().int().nullable(),
  summary: z.string(),
  outputExcerpt: z.string(),
});

export const coverageGapSchema = z.object({
  area: z.string(),
  missingTest: z.string(),
  risk: z.string(),
});

export const learnedRuleCandidateSchema = z.object({
  rule: z.string(),
  reason: z.string(),
  source: z.enum(["accepted-finding", "dismissed-finding", "missed-bug", "manual-edit", "audit-observation"]),
});

export const changedFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable().default(null),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  generated: z.boolean().default(false),
  skipped: z.boolean().default(false),
  skipReason: z.string().nullable().default(null),
});

export const diffLineSchema = z.object({
  kind: z.enum(["context", "added", "deleted"]),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
  text: z.string(),
});

export const sideLineSchema = z.object({
  line: z.number().int().positive(),
  kind: z.enum(["context", "added", "deleted"]),
  text: z.string(),
});

export const diffHunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  section: z.string(),
  lines: z.array(diffLineSchema),
  oldSideLines: z.array(sideLineSchema),
  newSideLines: z.array(sideLineSchema),
});

export const diffFileBundleSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  generated: z.boolean(),
  binary: z.boolean(),
  hunks: z.array(diffHunkSchema),
  tokenEstimate: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const skippedDiffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  reason: z.string(),
});

export const diffBudgetSchema = z.object({
  requestedTokens: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const diffBundleSchema = z.object({
  baseCommit: z.string(),
  headCommit: z.string(),
  effectiveBaseCommit: z.string(),
  files: z.array(diffFileBundleSchema),
  skippedFiles: z.array(skippedDiffFileSchema),
  budget: diffBudgetSchema,
});

export const diffIntakeSchema = z.object({
  repoPath: z.string(),
  repoRoot: z.string(),
  currentBranch: z.string(),
  upstreamRef: z.string(),
  requestedBaseRef: z.string(),
  requestedHeadRef: z.string(),
  resolvedBaseRef: z.string(),
  resolvedBaseCommit: z.string(),
  resolvedHeadRef: z.string(),
  resolvedHeadCommit: z.string(),
  baseResolution: z.string(),
  baselineStatus: z.enum(["resolved", "inconclusive"]),
  includeUncommitted: z.boolean(),
  hasUncommittedChanges: z.boolean(),
  untrackedFiles: stringList,
  changedFiles: z.array(changedFileSchema),
  auditConfig: effectiveAuditConfigSchema,
  diffBundle: diffBundleSchema,
  diffSummary: z.string(),
  unifiedDiff: z.string(),
  diffTruncated: z.boolean(),
  commandsRun: stringList,
  limitations: stringList,
});

export const changeMapSchema = z.object({
  summary: z.string(),
  changedFiles: z.array(
    z.object({
      path: z.string(),
      status: z.string(),
      likelyBehaviorChange: z.string(),
      symbols: stringList,
      riskCategories: z.array(z.enum(categories)),
      nearbyTests: stringList,
      contractsOrSchemas: stringList,
      runtimeSurfaces: stringList,
    }),
  ),
  crossFileRisks: stringList,
  testSurface: stringList,
  likelyBlastRadius: stringList,
  assumptions: stringList,
  limitations: stringList,
});

export const rulesRecallSchema = z.object({
  appliedRules: stringList,
  antiRules: stringList,
  priorAcceptedPatterns: stringList,
  priorDismissedPatterns: stringList,
  memoryLimitations: stringList,
});

export const riskClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      itemId: z.string(),
      category: z.enum(categories),
      reason: z.string(),
      riskLevel: z.enum(["high", "medium", "low"]),
      changedFiles: stringList,
      reviewFocus: stringList,
    }),
  ),
  skippedItems: stringList,
});

export const categoryReviewSchema = z.object({
  itemId: z.string(),
  category: z.enum(categories),
  riskLevel: z.enum(["high", "medium", "low"]),
  observations: stringList,
  recommendedContext: stringList,
  hunterPromptAdditions: stringList,
});

export const contextGatherSchema = z.object({
  sourceName: z.string(),
  filesRead: stringList,
  keyEvidence: stringList,
  relevantSnippets: z.array(
    z.object({
      file: z.string(),
      lineStart: z.number().int().nonnegative(),
      lineEnd: z.number().int().nonnegative(),
      summary: z.string(),
    }),
  ),
  limitations: stringList,
});

export const contextBundleSchema = z.object({
  summary: z.string(),
  filesRead: stringList,
  callsites: stringList,
  tests: stringList,
  contracts: stringList,
  runtimeSurfaces: stringList,
  highRiskAreas: stringList,
  limitations: stringList,
});

export const candidateBatchSchema = z.object({
  source: z.string(),
  category: z.enum(categories),
  summary: z.string(),
  candidates: z.array(findingSchema),
  weakSignals: stringList,
  discardedSignals: z.array(discardedFindingSchema),
  coverageGaps: z.array(coverageGapSchema),
  learnedRuleCandidates: z.array(learnedRuleCandidateSchema),
});

export const checkEvidenceSchema = z.object({
  summary: z.string(),
  commandsRun: z.array(checkResultSchema),
  skippedCommands: stringList,
  limitations: stringList,
});

export const synthesizedFindingsSchema = z.object({
  summary: z.string(),
  candidateFindings: z.array(findingSchema),
  discardedCandidates: z.array(discardedFindingSchema),
  coverageGaps: z.array(coverageGapSchema),
  learnedRuleCandidates: z.array(learnedRuleCandidateSchema),
  limitations: stringList,
});

export const validationArgumentSchema = z.object({
  position: z.enum(["for", "against"]),
  credibleFindingIds: stringList,
  challengedFindingIds: stringList,
  argument: z.string(),
  evidenceRefs: stringList,
  concerns: stringList,
});

export const validationReportSchema = z.object({
  verdict: z.enum(verdicts),
  summary: z.string(),
  findings: z.array(findingSchema),
  discardedFindings: z.array(discardedFindingSchema),
  coverageGaps: z.array(coverageGapSchema),
  learnedRuleCandidates: z.array(learnedRuleCandidateSchema),
  limitations: stringList,
});

export const confidenceSummarySchema = z.object({
  retained: z.number().int().nonnegative(),
  downgraded: z.number().int().nonnegative(),
  discarded: z.number().int().nonnegative(),
  threshold: z.enum(confidences),
});

export const auditReportSchema = z.object({
  verdict: z.enum(verdicts),
  summary: z.string(),
  findings: z.array(findingSchema),
  discardedFindings: z.array(discardedFindingSchema),
  checksRun: z.array(checkResultSchema),
  coverageGaps: z.array(coverageGapSchema),
  learnedRuleCandidates: z.array(learnedRuleCandidateSchema),
  limitations: stringList,
  diffBundle: diffBundleSchema,
  confidenceSummary: confidenceSummarySchema,
  reportPath: z.string(),
});

export const feedbackMemoryUpdateSchema = z.object({
  rememberedRules: z.array(learnedRuleCandidateSchema),
  rememberedAntiRules: z.array(learnedRuleCandidateSchema),
  notes: stringList,
});

export const bugRegressionAuditSchemas = {
  input: workflowInputSchema,
  diffIntake: diffIntakeSchema,
  changeMap: changeMapSchema,
  rulesRecall: rulesRecallSchema,
  riskClassification: riskClassificationSchema,
  categoryReview: categoryReviewSchema,
  contextGather: contextGatherSchema,
  contextBundle: contextBundleSchema,
  candidateBatch: candidateBatchSchema,
  checkEvidence: checkEvidenceSchema,
  synthesizedFindings: synthesizedFindingsSchema,
  validationArgument: validationArgumentSchema,
  validationReport: validationReportSchema,
  auditReport: auditReportSchema,
  output: auditReportSchema,
  feedbackMemoryUpdate: feedbackMemoryUpdateSchema,
};

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type EffectiveAuditConfig = z.infer<typeof effectiveAuditConfigSchema>;
export type DiffIntake = z.infer<typeof diffIntakeSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
export type CandidateBatch = z.infer<typeof candidateBatchSchema>;
export type CheckEvidence = z.infer<typeof checkEvidenceSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type DiffBundle = z.infer<typeof diffBundleSchema>;
export type DiffFileBundle = z.infer<typeof diffFileBundleSchema>;
export type SkippedDiffFile = z.infer<typeof skippedDiffFileSchema>;
export type ConfidenceSummary = z.infer<typeof confidenceSummarySchema>;
