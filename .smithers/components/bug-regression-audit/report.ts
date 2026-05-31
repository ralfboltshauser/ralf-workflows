import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditReport, CheckEvidence, DiffIntake, ValidationReport, WorkflowInput } from "./schemas";

const lines = (items: string[]) => (items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n"));

export const buildAuditReport = async (
  input: WorkflowInput,
  intake: DiffIntake,
  validation: ValidationReport,
  checks: CheckEvidence,
): Promise<AuditReport> => {
  const requestedOutputDir =
    typeof input.outputDir === "string" ? input.outputDir : ".smithers/bug-regression-audit-reports";
  const maxFindings = typeof input.maxFindings === "number" ? input.maxFindings : 10;
  const outputDir = path.isAbsolute(requestedOutputDir)
    ? requestedOutputDir
    : path.resolve(intake.repoRoot || process.cwd(), requestedOutputDir);
  await mkdir(outputDir, { recursive: true });

  const report: AuditReport = {
    verdict: validation.verdict,
    summary: validation.summary,
    findings: validation.findings.slice(0, maxFindings),
    discardedFindings: validation.discardedFindings,
    checksRun: checks.commandsRun,
    coverageGaps: validation.coverageGaps,
    learnedRuleCandidates: validation.learnedRuleCandidates,
    limitations: [...validation.limitations, ...checks.limitations, ...intake.limitations],
    reportPath: path.join(outputDir, "bug-regression-audit.md"),
  };

  await writeFile(report.reportPath, renderMarkdownReport(report, intake), "utf8");
  return report;
};

export const renderMarkdownReport = (report: AuditReport, intake: DiffIntake) => {
  const findingSections =
    report.findings.length === 0
      ? "No credible regression bugs survived validation."
      : report.findings
          .map(
            (finding, index) => `### ${index + 1}. ${finding.title}

- ID: \`${finding.id}\`
- Severity: ${finding.severity}
- Confidence: ${finding.confidence}
- Category: ${finding.category}
- Affected files: ${finding.affectedFiles.map((file) => `${file.path}${file.line ? `:${file.line}` : ""}`).join(", ")}

Bug hypothesis:
${finding.bugHypothesis}

Evidence:
${finding.evidence}

Why this looks new:
${finding.whyThisIsNewOrRegressionRisk}

Reproduction idea:
${finding.reproductionIdea}

Suggested test:
${finding.suggestedTest}

Suggested fix direction:
${finding.suggestedFixDirection}`,
          )
          .join("\n\n");

  return `# Bug Regression Audit

Verdict: ${report.verdict}

${report.summary}

## Diff Scope

- Repository: ${intake.repoRoot}
- Base: ${intake.resolvedBaseRef || "(unresolved)"} ${intake.resolvedBaseCommit ? `(${intake.resolvedBaseCommit.slice(0, 12)})` : ""}
- Head: ${intake.resolvedHeadRef || "(unresolved)"} ${intake.resolvedHeadCommit ? `(${intake.resolvedHeadCommit.slice(0, 12)})` : ""}
- Base resolution: ${intake.baseResolution}
- Changed files: ${intake.changedFiles.length}

## Findings

${findingSections}

## Validation Checks

${
  report.checksRun.length === 0
    ? "No validation checks were run."
    : report.checksRun
        .map((check) => `- ${check.result}: \`${check.command}\` - ${check.summary}`)
        .join("\n")
}

## Coverage Gaps

${lines(report.coverageGaps.map((gap) => `${gap.area}: ${gap.missingTest} (${gap.risk})`))}

## Discarded Findings

${lines(report.discardedFindings.map((finding) => `${finding.title}: ${finding.reasonDiscarded}`))}

## Learned Rule Candidates

${lines(report.learnedRuleCandidates.map((candidate) => `${candidate.rule} - ${candidate.reason}`))}

## Limitations

${lines(report.limitations)}
`;
};
