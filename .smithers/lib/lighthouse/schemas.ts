import { z } from "zod/v4";

export const lighthouseCategorySchema = z.enum([
  "performance",
  "accessibility",
  "best-practices",
  "seo",
]);

export const formFactorSchema = z.enum(["mobile", "desktop"]);

export const thresholdsSchema = z.object({
  performance: z.number().min(0).max(1).default(0.9),
  accessibility: z.number().min(0).max(1).default(0.95),
  bestPractices: z.number().min(0).max(1).default(0.95),
  seo: z.number().min(0).max(1).default(0.95),
});

export const lighthouseInputSchema = z.object({
  repoPath: z.string().default("."),
  localUrl: z.string().default("http://localhost:3000"),
  localServeCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  staticDistDir: z.string().optional(),
  prodUrl: z.string().optional(),
  allowProdCheck: z.boolean().default(false),
  routes: z.array(z.string()).default(["/"]),
  numberOfRuns: z.number().int().min(1).max(7).default(5),
  formFactors: z.array(formFactorSchema).min(1).default(["mobile"]),
  categories: z.array(lighthouseCategorySchema).min(1).default([
    "performance",
    "accessibility",
    "best-practices",
    "seo",
  ]),
  allowImplementation: z.boolean().default(true),
  approvalMode: z.enum(["auto", "always", "never"]).default("auto"),
  maxPlanReviewIterations: z.number().int().min(1).max(5).default(2),
  maxImplementationReviewIterations: z.number().int().min(1).max(5).default(2),
  maxOptimizationIterations: z.number().int().min(1).max(5).default(3),
  thresholds: thresholdsSchema.default({
    performance: 0.9,
    accessibility: 0.95,
    bestPractices: 0.95,
    seo: 0.95,
  }),
  outputDir: z.string().default(".smithers/lighthouse-reports"),
  appProfile: z.string().optional(),
});

export const commandResultSchema = z.object({
  label: z.string(),
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  stdoutPath: z.string(),
  stderrPath: z.string(),
  summary: z.string(),
});

export const localRuntimeInputSchema = z.object({
  localUrl: z.string().optional(),
  localServeCommand: z.string().optional(),
  staticDistDir: z.string().optional(),
  buildCommand: z.string().optional(),
  notes: z.string().optional(),
});

export const serverReadinessSchema = z.object({
  satisfied: z.boolean(),
  checkedUrl: z.string(),
  statusCode: z.number().nullable(),
  error: z.string(),
});

export const lighthouseTargetSchema = z.object({
  kind: z.enum(["local", "prod"]),
  enabled: z.boolean(),
  mode: z.enum(["url", "server-command", "static", "skipped"]),
  baseUrl: z.string(),
  urls: z.array(z.string()),
  routes: z.array(z.string()),
  serveCommand: z.string(),
  staticDistDir: z.string(),
  notes: z.array(z.string()),
});

export const targetPlanSchema = z.object({
  repoPath: z.string(),
  outputDir: z.string(),
  scratchRoot: z.string(),
  numberOfRuns: z.number(),
  formFactors: z.array(formFactorSchema),
  categories: z.array(lighthouseCategorySchema),
  thresholds: thresholdsSchema,
  buildCommand: z.string(),
  local: lighthouseTargetSchema,
  prod: lighthouseTargetSchema,
  approvalMode: z.enum(["auto", "always", "never"]),
  allowImplementation: z.boolean(),
  maxPlanReviewIterations: z.number(),
  maxImplementationReviewIterations: z.number(),
  maxOptimizationIterations: z.number(),
  appProfile: z.string(),
});

export const lighthouseRunSchema = z.object({
  target: z.enum(["local", "prod"]),
  phase: z.enum(["baseline", "after"]),
  status: z.enum(["ran", "skipped", "failed"]),
  configPaths: z.array(z.string()),
  artifactDirectories: z.array(z.string()),
  scratchDirectories: z.array(z.string()),
  manifestPaths: z.array(z.string()),
  reportFiles: z.array(z.string()),
  commands: z.array(commandResultSchema),
  notes: z.array(z.string()),
});

export const auditSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().nullable(),
  displayValue: z.string(),
  numericValue: z.number().nullable(),
  savingsMs: z.number().nullable(),
  description: z.string(),
});

export const pageSummarySchema = z.object({
  sourcePath: z.string(),
  requestedUrl: z.string(),
  finalUrl: z.string(),
  formFactor: z.string(),
  fetchTime: z.string(),
  lighthouseVersion: z.string(),
  categoryScores: z.record(z.string(), z.number().nullable()),
  metrics: z.record(z.string(), z.number().nullable()),
  opportunities: z.array(auditSummarySchema),
  failedAudits: z.array(auditSummarySchema),
  diagnostics: z.array(auditSummarySchema),
  runtimeError: z.string(),
  warnings: z.array(z.string()),
});

export const lighthouseSummarySchema = z.object({
  target: z.enum(["local", "prod", "combined"]),
  phase: z.enum(["baseline", "after"]),
  status: z.enum(["parsed", "empty", "skipped"]),
  representativeReportPath: z.string(),
  representativeUrl: z.string(),
  categoryScores: z.record(z.string(), z.number().nullable()),
  metrics: z.record(z.string(), z.number().nullable()),
  pages: z.array(pageSummarySchema),
  topOpportunities: z.array(auditSummarySchema),
  failedAudits: z.array(auditSummarySchema),
  diagnostics: z.array(auditSummarySchema),
  runtimeErrors: z.array(z.string()),
  warnings: z.array(z.string()),
  artifactDirectories: z.array(z.string()),
  notes: z.array(z.string()),
});

export const codebaseReviewSchema = z.object({
  summary: z.string(),
  framework: z.string(),
  packageManager: z.string(),
  importantFiles: z.array(z.string()),
  likelyRootCauses: z.array(
    z.object({
      issue: z.string(),
      evidence: z.string(),
      files: z.array(z.string()),
      suggestedDirection: z.string(),
    }),
  ),
  verificationCommands: z.array(z.string()),
  constraints: z.array(z.string()),
  missingContext: z.array(z.string()),
});

export const remediationPlanSchema = z.object({
  summary: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  requiresHumanApproval: z.boolean(),
  workItems: z.array(
    z.object({
      priority: z.enum(["p0", "p1", "p2", "p3"]),
      title: z.string(),
      lighthouseEvidence: z.string(),
      codebaseEvidence: z.string(),
      filesExpectedToChange: z.array(z.string()),
      implementationApproach: z.string(),
      verification: z.array(z.string()),
      requiresApproval: z.boolean(),
    }),
  ),
  outOfScope: z.array(z.string()),
  approvalRationale: z.string(),
});

export const reviewerFindingSchema = z.object({
  title: z.string(),
  severity: z.enum(["blocking", "major", "minor", "note"]),
  rationale: z.string(),
  requiredChange: z.string(),
});

export const planReviewPanelistSchema = z.object({
  role: z.string(),
  approved: z.boolean(),
  findings: z.array(reviewerFindingSchema),
  summary: z.string(),
});

export const planReviewSchema = z.object({
  approved: z.boolean(),
  iterationNeeded: z.boolean(),
  criticalityApproved: z.boolean(),
  codebaseFitApproved: z.boolean(),
  requiredChanges: z.array(z.string()),
  summary: z.string(),
});

export const approvalPolicySchema = z.object({
  requiresHumanApproval: z.boolean(),
  reason: z.string(),
});

export const humanApprovalSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  requiredChanges: z.array(z.string()),
});

export const planGateSchema = z.object({
  ready: z.boolean(),
  shouldImplement: z.boolean(),
  feedbackForNextPlan: z.array(z.string()),
  reason: z.string(),
});

export const implementationResultSchema = z.object({
  status: z.enum(["implemented", "skipped", "failed"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  notes: z.array(z.string()),
});

export const verificationResultSchema = z.object({
  passed: z.boolean(),
  commands: z.array(commandResultSchema),
  missingCommands: z.array(z.string()),
  summary: z.string(),
});

export const implementationReviewPanelistSchema = z.object({
  role: z.string(),
  approved: z.boolean(),
  findings: z.array(reviewerFindingSchema),
  summary: z.string(),
});

export const implementationReviewSchema = z.object({
  approved: z.boolean(),
  complete: z.boolean(),
  codebaseFitApproved: z.boolean(),
  requiredChanges: z.array(z.string()),
  summary: z.string(),
});

export const lighthouseComparisonSchema = z.object({
  status: z.enum(["great", "needs-iteration", "blocked", "not-run"]),
  greatEnough: z.boolean(),
  categoryDeltas: z.record(z.string(), z.number().nullable()),
  metricDeltas: z.record(z.string(), z.number().nullable()),
  improvements: z.array(z.string()),
  regressions: z.array(z.string()),
  remainingIssues: z.array(z.string()),
  recommendation: z.string(),
});

export const finalReportDraftSchema = z.object({
  status: z.enum(["completed", "plan-only", "blocked", "failed"]),
  artifactDirectory: z.string(),
  summary: z.string(),
  beforeAfterSummary: z.string(),
  implementedChanges: z.array(z.string()),
  remainingIssues: z.array(z.string()),
  verificationSummary: z.string(),
  limitations: z.array(z.string()),
  markdown: z.string(),
});

export const finalReportReviewSchema = z.object({
  approved: z.boolean(),
  qualityScore: z.number().min(0).max(1),
  summary: z.string(),
  requiredChanges: z.array(z.string()),
  improvedMarkdown: z.string(),
});

export const finalReportSchema = z.object({
  status: z.enum(["completed", "plan-only", "blocked", "failed"]),
  reportPath: z.string(),
  artifactDirectory: z.string(),
  summary: z.string(),
  beforeAfterSummary: z.string(),
  implementedChanges: z.array(z.string()),
  remainingIssues: z.array(z.string()),
  verificationSummary: z.string(),
  limitations: z.array(z.string()),
  markdown: z.string(),
});

export type LighthouseInput = z.infer<typeof lighthouseInputSchema>;
export type TargetPlan = z.infer<typeof targetPlanSchema>;
export type LocalRuntimeInput = z.infer<typeof localRuntimeInputSchema>;
export type LighthouseRun = z.infer<typeof lighthouseRunSchema>;
export type LighthouseSummary = z.infer<typeof lighthouseSummarySchema>;
export type CodebaseReview = z.infer<typeof codebaseReviewSchema>;
export type RemediationPlan = z.infer<typeof remediationPlanSchema>;
export type PlanReview = z.infer<typeof planReviewSchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type HumanApproval = z.infer<typeof humanApprovalSchema>;
export type PlanGate = z.infer<typeof planGateSchema>;
export type ImplementationResult = z.infer<typeof implementationResultSchema>;
export type ImplementationReview = z.infer<typeof implementationReviewSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type LighthouseComparison = z.infer<typeof lighthouseComparisonSchema>;
export type FinalReportDraft = z.infer<typeof finalReportDraftSchema>;
export type FinalReportReview = z.infer<typeof finalReportReviewSchema>;
export type FinalReport = z.infer<typeof finalReportSchema>;
