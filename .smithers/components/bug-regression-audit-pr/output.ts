import type {
  AuditReport,
  CheckoutResult,
  CommentPlan,
  PrAuditOutput,
  PrMetadata,
  PrResolution,
  PublishResult,
  WorkflowInput,
} from "./schemas";
import { emptyAuditReport, writePrReport } from "./format";

export const buildAuditSubflowInput = (input: WorkflowInput, checkout: CheckoutResult, pr: PrMetadata) => ({
  repoPath: checkout.checkoutPath,
  baseRef: checkout.effectiveBaseSha || pr.effectiveBaseSha || pr.baseSha,
  headRef: pr.headSha,
  includeUncommitted: false,
  auditMode: input.auditMode ?? "standard",
  maxFindings: input.maxFindings ?? 10,
  outputDir: checkout.auditOutputDir,
  checkCommands: input.checkCommands ?? [],
});

const statusFromAudit = (input: WorkflowInput, audit: AuditReport, publish: PublishResult): PrAuditOutput["status"] => {
  if (publish.failed) return "failed";
  if (audit.verdict === "inconclusive") return "inconclusive";
  if (audit.findings.length === 0 && !input.postNoFindingsSummary) return "no_findings";
  if (publish.published?.reviewUrl || publish.published?.summaryCommentUrl) return "posted";
  return "prepared";
};

const compactAuditForPrOutput = (audit: AuditReport): AuditReport => ({
  verdict: audit.verdict,
  summary: audit.summary,
  findings: audit.findings,
  discardedFindings: audit.discardedFindings,
  checksRun: audit.checksRun,
  coverageGaps: audit.coverageGaps,
  learnedRuleCandidates: audit.learnedRuleCandidates,
  limitations: audit.limitations,
  diffBundle: {
    ...audit.diffBundle,
    files: audit.diffBundle.files.map((file) => ({
      ...file,
      hunks: [],
      truncated: file.truncated || file.hunks.length > 0,
    })),
  },
  confidenceSummary: audit.confidenceSummary,
  reportPath: audit.reportPath,
});

export const buildFinalOutput = async (
  input: WorkflowInput,
  pr: PrMetadata,
  audit: AuditReport,
  plan: CommentPlan,
  publish: PublishResult,
  extraLimitations: string[] = [],
) => {
  const cleanAudit = compactAuditForPrOutput(audit);
  const outputPr = { ...pr, effectiveBaseSha: pr.effectiveBaseSha || cleanAudit.diffBundle.effectiveBaseCommit || pr.baseSha };
  return writePrReport(input, {
    status: statusFromAudit(input, audit, publish),
    pr: outputPr,
    audit: cleanAudit,
    inlineComments: plan.inlineComments,
    summaryComment: plan.summaryComment,
    unanchoredFindings: plan.unanchoredFindings,
    published: publish.published,
    limitations: [
      ...cleanAudit.limitations,
      ...plan.limitations,
      ...publish.limitations,
      ...extraLimitations,
      "PR output compacts diff hunk details; use audit.reportPath for the full local audit report.",
    ],
  });
};

export const buildFailedOutput = async (
  input: WorkflowInput,
  resolution: PrResolution,
  summary: string,
  limitations: string[],
) => {
  const audit = await emptyAuditReport(input, summary);
  return writePrReport(input, {
    status: "failed",
    pr: resolution.pr,
    audit,
    inlineComments: [],
    summaryComment: "",
    unanchoredFindings: [],
    published: null,
    limitations: [...resolution.limitations, ...limitations],
  });
};
