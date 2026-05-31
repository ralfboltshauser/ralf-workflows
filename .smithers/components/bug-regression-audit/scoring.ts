import type {
  CheckEvidence,
  ConfidenceSummary,
  DiffBundle,
  DiffIntake,
  ValidationReport,
} from "./schemas";

const confidenceRank = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

const rankConfidence = (confidence: keyof typeof confidenceRank) => confidenceRank[confidence] ?? 1;

const confidenceFromRank = (rank: number): keyof typeof confidenceRank => {
  if (rank >= 3) return "high";
  if (rank === 2) return "medium";
  return "low";
};

const changedLineIndex = (diffBundle: DiffBundle) => {
  const index = new Map<string, Map<number, "added" | "context">>();
  for (const file of diffBundle.files) {
    const lineKinds = new Map<number, "added" | "context">();
    for (const hunk of file.hunks) {
      for (const line of hunk.newSideLines) {
        const existing = lineKinds.get(line.line);
        if (existing === "added") continue;
        lineKinds.set(line.line, line.kind === "added" ? "added" : "context");
      }
    }
    index.set(file.path, lineKinds);
    if (file.oldPath) {
      index.set(file.oldPath, lineKinds);
    }
  }
  return index;
};

const nonEmptyEvidence = (value: string) => value.trim().length >= 20;

const hasFailedCheck = (checks: CheckEvidence) =>
  checks.commandsRun.some((check) => check.result === "failed" && check.outputExcerpt.trim().length > 0);

export const applyConfidenceScoring = (
  validation: ValidationReport,
  intake: DiffIntake,
  checks: CheckEvidence,
): { validation: ValidationReport; summary: ConfidenceSummary } => {
  const lineIndex = changedLineIndex(intake.diffBundle);
  const threshold = intake.auditConfig.minConfidence;
  const retained: ValidationReport["findings"] = [];
  const discarded: ValidationReport["discardedFindings"] = [...validation.discardedFindings];
  let downgraded = 0;
  let discardedByScoring = 0;
  const checksFailed = hasFailedCheck(checks);

  for (const finding of validation.findings) {
    const reasons: string[] = [];
    let score = rankConfidence(finding.confidence);
    const fileEvidence = finding.affectedFiles.filter((file) => lineIndex.has(file.path));
    const lineEvidence = fileEvidence.filter((file) => file.line != null && lineIndex.get(file.path)?.has(file.line));
    const changedLineEvidence = lineEvidence.some(
      (file) => file.line != null && lineIndex.get(file.path)?.get(file.line) === "added",
    );

    if (fileEvidence.length === 0) {
      score -= 2;
      reasons.push("no affected file matches the changed diff bundle");
    } else if (lineEvidence.length === 0) {
      score -= 1;
      reasons.push("affected file matches the diff, but no affected line is anchorable on the new side");
    } else if (!changedLineEvidence) {
      score -= 1;
      reasons.push("affected line is only context, not an added or directly changed right-side line");
    }

    if (!nonEmptyEvidence(finding.evidence) || !nonEmptyEvidence(finding.whyThisIsNewOrRegressionRisk)) {
      score -= 1;
      reasons.push("evidence or regression reasoning is too thin");
    }

    if (!nonEmptyEvidence(finding.reproductionIdea) && !checksFailed) {
      score -= 1;
      reasons.push("reproduction path is underspecified and no validation check failed");
    }

    if (score < rankConfidence(threshold)) {
      discarded.push({
        id: `${finding.id}-confidence-filter`,
        title: finding.title,
        originalCategory: finding.category,
        reasonDiscarded: `Discarded by confidence scoring below ${threshold}: ${reasons.join("; ") || "insufficient evidence"}.`,
      });
      discardedByScoring += 1;
      continue;
    }

    const nextConfidence = confidenceFromRank(score);
    if (nextConfidence !== finding.confidence) {
      downgraded += 1;
    }
    retained.push({
      ...finding,
      confidence: nextConfidence,
      evidence:
        reasons.length > 0
          ? `${finding.evidence}\n\nConfidence scoring notes: ${reasons.join("; ")}.`
          : finding.evidence,
    });
  }

  return {
    validation: {
      ...validation,
      verdict:
        retained.length > 0
          ? "bugs_found"
          : validation.verdict === "inconclusive"
            ? "inconclusive"
            : "no_clear_bugs",
      findings: retained,
      discardedFindings: discarded,
    },
    summary: {
      retained: retained.length,
      downgraded,
      discarded: discardedByScoring,
      threshold,
    },
  };
};
