import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditReport,
  PreparedInlineComment,
  PrAuditOutput,
  PrMetadata,
  UnanchoredFinding,
  WorkflowInput,
} from "./schemas";

const lines = (items: string[]) => (items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n"));

export const renderInlineCommentBody = (
  finding: AuditReport["findings"][number],
  affectedFiles: string,
) => `**Smithers bug regression audit: ${finding.title}**

- Severity: ${finding.severity}
- Confidence: ${finding.confidence}
- Category: ${finding.category}
- Affected evidence: ${affectedFiles || "not specified"}

${finding.bugHypothesis}

Evidence: ${finding.evidence}

Regression reasoning: ${finding.whyThisIsNewOrRegressionRisk}

Suggested test: ${finding.suggestedTest}

Fix direction: ${finding.suggestedFixDirection}`;

export const renderSummaryComment = (
  pr: PrMetadata,
  audit: AuditReport,
  inlineComments: PreparedInlineComment[],
  unanchoredFindings: UnanchoredFinding[],
) => `<!-- smithers-bug-regression-audit-pr:summary -->
# Smithers Bug Regression Audit

PR: ${pr.owner}/${pr.repo}#${pr.number}
Head SHA: ${pr.headSha || "(unknown)"}
GitHub base SHA: ${pr.baseSha || "(unknown)"}
Effective audit base SHA: ${pr.effectiveBaseSha || pr.baseSha || "(unknown)"}

Verdict: ${audit.verdict}

${audit.summary}

Inline comments prepared: ${inlineComments.length}
Unanchored findings: ${unanchoredFindings.length}

## Findings

${
  audit.findings.length === 0
    ? "No credible regression bugs survived validation."
    : audit.findings
        .map(
          (finding, index) => `### ${index + 1}. ${finding.title}

- ID: \`${finding.id}\`
- Severity: ${finding.severity}
- Confidence: ${finding.confidence}
- Category: ${finding.category}
- Affected files: ${finding.affectedFiles.map((file) => `${file.path}${file.line ? `:${file.line}` : ""}`).join(", ")}

${finding.bugHypothesis}

Suggested test: ${finding.suggestedTest}

Fix direction: ${finding.suggestedFixDirection}`,
        )
        .join("\n\n")
}

## Unanchored Findings

${lines(unanchoredFindings.map((finding) => `${finding.title}: ${finding.reason}`))}

## Checks

${lines(audit.checksRun.map((check) => `${check.result}: \`${check.command}\` - ${check.summary}`))}

## Limitations

${lines(audit.limitations)}`;

export const renderInlineFallbackSection = (inlineComments: PreparedInlineComment[]) =>
  inlineComments.length === 0
    ? ""
    : `\n\n## Inline Findings Not Posted Inline\n\n${inlineComments
        .map((comment) => `- ${comment.path}:${comment.line} ${comment.title}\n\n${comment.body}`)
        .join("\n\n")}`;

const renderPrReport = (output: PrAuditOutput) => `# Bug Regression Audit PR

Status: ${output.status}

PR: ${output.pr.url}

${output.audit.summary}

## Publishing

- Inline comments prepared: ${output.inlineComments.length}
- Unanchored findings: ${output.unanchoredFindings.length}
- Review URL: ${output.published?.reviewUrl ?? "(none)"}
- Summary comment URL: ${output.published?.summaryCommentUrl ?? "(none)"}
- Skipped duplicates: ${output.published?.skippedDuplicateCount ?? 0}

## Inline Comments

${lines(output.inlineComments.map((comment) => `${comment.path}:${comment.line} ${comment.title}`))}

## Unanchored Findings

${lines(output.unanchoredFindings.map((finding) => `${finding.title}: ${finding.reason}`))}

## Summary Comment

${output.summaryComment}

## Limitations

${lines(output.limitations)}
`;

export const resolveOutputDir = (input: WorkflowInput) =>
  path.resolve(process.cwd(), input.outputDir ?? ".smithers/bug-regression-audit-pr-reports");

export const writePrReport = async (input: WorkflowInput, output: Omit<PrAuditOutput, "reportPath">) => {
  const outputDir = resolveOutputDir(input);
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `bug-regression-audit-pr-${output.pr.number || "unknown"}.md`);
  const completeOutput: PrAuditOutput = { ...output, reportPath };
  await writeFile(reportPath, renderPrReport(completeOutput), "utf8");
  return completeOutput;
};

export const emptyAuditReport = async (input: WorkflowInput, summary: string): Promise<AuditReport> => {
  const outputDir = resolveOutputDir(input);
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "bug-regression-audit-empty.md");
  const audit: AuditReport = {
    verdict: "inconclusive",
    summary,
    findings: [],
    discardedFindings: [],
    checksRun: [],
    coverageGaps: [],
    learnedRuleCandidates: [],
    limitations: [summary],
    diffBundle: {
      baseCommit: "",
      headCommit: "",
      effectiveBaseCommit: "",
      files: [],
      skippedFiles: [],
      budget: {
        requestedTokens: 1,
        estimatedTokens: 0,
        truncated: false,
      },
    },
    confidenceSummary: {
      retained: 0,
      downgraded: 0,
      discarded: 0,
      threshold: "low",
    },
    reportPath,
  };
  await writeFile(reportPath, `# Bug Regression Audit\n\nVerdict: inconclusive\n\n${summary}\n`, "utf8");
  return audit;
};
