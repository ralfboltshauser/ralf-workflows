import type {
  ApprovalPolicy,
  CodebaseReview,
  FinalReportDraft,
  HumanApproval,
  LighthouseComparison,
  LighthouseSummary,
  PlanGate,
  PlanReview,
  RemediationPlan,
  TargetPlan,
  VerificationResult,
} from "./schemas";

const json = (value: unknown) => JSON.stringify(value, null, 2);

export const workflowMethodBrief = `
You are working inside a Smithers Lighthouse optimization workflow.

Principles:
- Treat Lighthouse as evidence, not as the whole diagnosis.
- Always tie Lighthouse issues to concrete codebase causes before proposing changes.
- Prefer production-like local checks over dev-mode checks for performance judgment.
- Do not chase tiny score deltas when remaining work requires broad architecture changes.
- Keep changes aligned with the codebase's existing patterns and verification commands.
- For approval denial, use the human feedback as planning input; do not stop unless the workflow is blocked.
`;

export function codebaseReviewPrompt(plan: TargetPlan, localSummary: LighthouseSummary, prodSummary?: LighthouseSummary) {
  return `
${workflowMethodBrief}

Review the codebase for Lighthouse improvement opportunities.

Target plan:
${json(plan)}

Local Lighthouse summary:
${json(localSummary)}

Production Lighthouse summary, if collected:
${json(prodSummary ?? null)}

Work:
1. Inspect the repository at repoPath.
2. Identify framework, package manager, app entry points, routing, asset pipeline, image/font usage, scripts, and likely verification commands.
3. Map the biggest Lighthouse issues to likely root causes and files.
4. Keep suggestions local and maintainable; record large architecture changes as constraints or out-of-scope.
5. Return only the required JSON object.
`;
}

export function remediationPlanPrompt(args: {
  plan: TargetPlan;
  localSummary: LighthouseSummary;
  prodSummary?: LighthouseSummary;
  codebaseReview: unknown;
  previousComparison?: LighthouseComparison;
  previousGate?: PlanGate;
  previousReview?: PlanReview;
  previousApproval?: HumanApproval;
}) {
  return `
${workflowMethodBrief}

Draft or revise the remediation plan.

Target plan:
${json(args.plan)}

Local Lighthouse summary:
${json(args.localSummary)}

Production Lighthouse summary:
${json(args.prodSummary ?? null)}

Codebase review:
${json(args.codebaseReview)}

Previous comparison, if any:
${json(args.previousComparison ?? null)}

Previous plan gate feedback, if any:
${json(args.previousGate ?? null)}

Previous reviewer feedback, if any:
${json(args.previousReview ?? null)}

Previous human approval feedback, if any:
${json(args.previousApproval ?? null)}

Work:
1. Prioritize the highest-impact Lighthouse and user-experience issues.
2. Propose a small, coherent batch of changes that fits the codebase.
3. If approvalMode is "never" or allowImplementation is false, set requiresHumanApproval=false and every work item requiresApproval=false. Describe infra/product approval needs as external ownership dependencies or handoff notes, not in-workflow gates.
4. If approvalMode is not "never", mark requiresHumanApproval=true for dependency, build, server, routing, cache/CDN, large visual, or broad architecture changes.
5. If the repository contains only artifacts and no source code, use implementation surfaces and "TBD until source checkout" instead of speculative file paths.
6. Put low-value or broad rewrites in outOfScope.
7. Return only the required JSON object.
`;
}

export function planReviewerPrompt(role: "criticality" | "codebase-fit", plan: RemediationPlan, context: unknown) {
  const roleInstruction =
    role === "criticality"
      ? "Review whether the plan addresses the most critical Lighthouse and user-experience issues, not tiny score noise."
      : "Review whether the plan fits the existing codebase without broad rewrites or unnecessary architectural churn.";

  return `
${workflowMethodBrief}

${roleInstruction}

Plan:
${json(plan)}

Context:
${json(context)}

Return only the required JSON object. Set approved=false for any blocking or major issue.
`;
}

export function planModeratorPrompt(args: {
  criticalityReview: unknown;
  codebaseFitReview: unknown;
  plan: RemediationPlan;
}) {
  return `
${workflowMethodBrief}

Moderate the plan review.

Criticality review:
${json(args.criticalityReview)}

Codebase-fit review:
${json(args.codebaseFitReview)}

Plan:
${json(args.plan)}

Work:
1. Approve only if both reviewer concerns are satisfied or only minor notes remain.
2. Convert reviewer objections into concrete requiredChanges.
3. Return only the required JSON object.
`;
}

export function humanApprovalPrompt(args: {
  plan: RemediationPlan;
  review: PlanReview;
  policy: ApprovalPolicy;
}) {
  return `
Review this Lighthouse remediation plan.

Approval policy:
${json(args.policy)}

Plan review:
${json(args.review)}

Plan:
${json(args.plan)}

Respond as JSON:
{
  "approved": true or false,
  "feedback": "short explanation",
  "requiredChanges": ["specific requested plan change"]
}
`;
}

export function implementationPrompt(args: {
  plan: TargetPlan;
  remediationPlan: RemediationPlan;
  review: PlanReview;
}) {
  return `
${workflowMethodBrief}

Implement the accepted Lighthouse remediation plan in the repository at repoPath.

Target plan:
${json(args.plan)}

Accepted remediation plan:
${json(args.remediationPlan)}

Plan review:
${json(args.review)}

Implementation rules:
1. Modify only the audited repository at repoPath.
2. Keep changes scoped to the accepted plan.
3. Do not make broad rewrites, dependency changes, routing changes, or visual redesigns unless the accepted plan explicitly allows them.
4. Preserve existing code style and framework patterns.
5. Return only the required JSON object with filesChanged and notes.
`;
}

export function implementationReviewerPrompt(
  role: "completeness" | "codebase-fit",
  args: {
    targetPlan: TargetPlan;
    remediationPlan: RemediationPlan;
    verification?: VerificationResult;
  },
) {
  const roleInstruction =
    role === "completeness"
      ? "Check whether the accepted plan was fully implemented and verified."
      : "Check whether the implementation stayed aligned with the codebase and avoided unnecessary churn.";

  return `
${workflowMethodBrief}

${roleInstruction}

Target plan:
${json(args.targetPlan)}

Accepted plan:
${json(args.remediationPlan)}

Verification:
${json(args.verification ?? null)}

Inspect the repository and return only the required JSON object.
`;
}

export function implementationModeratorPrompt(args: {
  completenessReview: unknown;
  codebaseFitReview: unknown;
  verification?: VerificationResult;
}) {
  return `
${workflowMethodBrief}

Moderate implementation review.

Completeness review:
${json(args.completenessReview)}

Codebase-fit review:
${json(args.codebaseFitReview)}

Verification:
${json(args.verification ?? null)}

Approve only if implementation is complete enough, fits the codebase, and verification status is acceptable or limitations are clearly explained.
Return only the required JSON object.
`;
}

export function finalReportReviewPrompt(args: {
  draft: FinalReportDraft;
  targetPlan: TargetPlan;
  baselineSummary: LighthouseSummary;
  prodSummary?: LighthouseSummary;
  codebaseReview?: CodebaseReview;
  remediationPlan?: RemediationPlan;
  planReview?: PlanReview;
  comparison?: LighthouseComparison;
}) {
  return `
${workflowMethodBrief}

Review the final Lighthouse report draft as the last quality gate before publishing it.

Target plan:
${json(args.targetPlan)}

Local baseline summary:
${json(args.baselineSummary)}

Production summary, if collected:
${json(args.prodSummary ?? null)}

Codebase review:
${json(args.codebaseReview ?? null)}

Remediation plan:
${json(args.remediationPlan ?? null)}

Plan review:
${json(args.planReview ?? null)}

Lighthouse comparison:
${json(args.comparison ?? null)}

Draft report:
${args.draft.markdown}

Quality bar:
1. The report must be directly useful to the engineer who will make or review the changes.
2. It must include local baseline scores, key metrics, failed audits, and artifact paths.
3. It must connect the biggest Lighthouse issues to codebase evidence and concrete remediation work.
4. It must accurately state whether implementation, verification, and after-change Lighthouse ran.
5. It must call out limitations without overclaiming production impact or score improvements.

Return only the required JSON object. Always include improvedMarkdown; use an empty string when approved=true. If approved=false, include concrete requiredChanges and an improvedMarkdown string that fully replaces the draft.
`;
}
