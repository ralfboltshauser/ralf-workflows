import { z } from "zod/v4";
import { auditModes, auditReportSchema, findingSchema, stringList } from "../bug-regression-audit/schemas";

export const publishModes = ["dry-run", "summary-comment", "review"] as const;
export const prWorkflowStatuses = ["prepared", "posted", "no_findings", "inconclusive", "failed"] as const;

export const workflowInputSchema = z.object({
  pr: z.string(),
  auditMode: z.enum(auditModes).default("standard"),
  maxFindings: z.number().int().positive().default(10),
  checkCommands: stringList.default([]),
  outputDir: z.string().default(".smithers/bug-regression-audit-pr-reports"),
  checkoutDir: z.string().optional(),
  publishMode: z.enum(publishModes).default("dry-run"),
  dedupe: z.boolean().default(true),
  postNoFindingsSummary: z.boolean().default(false),
});

export const prMetadataSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  effectiveBaseSha: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  isDraft: z.boolean(),
  cloneUrl: z.string(),
});

export const prResolutionSchema = z.object({
  status: z.enum(["resolved", "failed"]),
  pr: prMetadataSchema,
  summary: z.string(),
  limitations: stringList,
});

export const checkoutSchema = z.object({
  status: z.enum(["ready", "failed"]),
  checkoutPath: z.string(),
  auditOutputDir: z.string(),
  effectiveBaseSha: z.string(),
  summary: z.string(),
  commandsRun: stringList,
  limitations: stringList,
});

export const pullRequestFileSchema = z.object({
  filename: z.string(),
  previousFilename: z.string().nullable(),
  status: z.string(),
  patch: z.string().nullable(),
});

export const preparedInlineCommentSchema = z.object({
  findingId: z.string(),
  title: z.string(),
  severity: z.string(),
  confidence: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  side: z.literal("RIGHT"),
  body: z.string(),
  dedupeKey: z.string(),
});

export const unanchoredFindingSchema = z.object({
  findingId: z.string(),
  title: z.string(),
  reason: z.string(),
  affectedFiles: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive().nullable(),
      symbol: z.string().nullable(),
    }),
  ),
});

export const commentPlanSchema = z.object({
  inlineComments: z.array(preparedInlineCommentSchema),
  summaryComment: z.string(),
  unanchoredFindings: z.array(unanchoredFindingSchema),
  filesConsidered: z.array(pullRequestFileSchema),
  limitations: stringList,
});

export const publishedResultSchema = z.object({
  reviewUrl: z.string().optional(),
  summaryCommentUrl: z.string().optional(),
  skippedDuplicateCount: z.number().int().nonnegative(),
});

export const publishResultSchema = z.object({
  mode: z.enum(publishModes),
  failed: z.boolean(),
  published: publishedResultSchema.nullable(),
  limitations: stringList,
});

export const prAuditOutputSchema = z.object({
  status: z.enum(prWorkflowStatuses),
  pr: prMetadataSchema,
  audit: auditReportSchema,
  inlineComments: z.array(preparedInlineCommentSchema),
  summaryComment: z.string(),
  unanchoredFindings: z.array(unanchoredFindingSchema),
  published: publishedResultSchema.nullable(),
  reportPath: z.string(),
  limitations: stringList,
});

export const bugRegressionAuditPrSchemas = {
  input: workflowInputSchema,
  prResolution: prResolutionSchema,
  checkout: checkoutSchema,
  audit: auditReportSchema,
  commentPlan: commentPlanSchema,
  publishResult: publishResultSchema,
  output: prAuditOutputSchema,
};

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type PrMetadata = z.infer<typeof prMetadataSchema>;
export type PrResolution = z.infer<typeof prResolutionSchema>;
export type CheckoutResult = z.infer<typeof checkoutSchema>;
export type PullRequestFile = z.infer<typeof pullRequestFileSchema>;
export type PreparedInlineComment = z.infer<typeof preparedInlineCommentSchema>;
export type UnanchoredFinding = z.infer<typeof unanchoredFindingSchema>;
export type CommentPlan = z.infer<typeof commentPlanSchema>;
export type PublishResult = z.infer<typeof publishResultSchema>;
export type PrAuditOutput = z.infer<typeof prAuditOutputSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
export type Finding = z.infer<typeof findingSchema>;
