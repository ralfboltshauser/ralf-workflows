// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Lighthouse Check
// smithers-description: Run local and optional production Lighthouse checks, review artifacts and codebase context, and produce a reviewed remediation report.
// smithers-tags: lighthouse, performance, accessibility, seo, web, optimization
/** @jsxImportSource smithers-orchestrator */
import { HumanTask, Poller, createSmithers } from "smithers-orchestrator";
import { CodexAgent } from "../agents";
import {
  buildAndWriteFinalReportDraft,
  checkServerReady,
  codebaseReviewPrompt,
  compareLighthouseSummaries,
  coerceLighthouseInput,
  createTargetPlan,
  determineApprovalPolicy,
  evaluatePlanGate,
  humanApprovalPrompt,
  implementationModeratorPrompt,
  implementationPrompt,
  implementationReviewerPrompt,
  lighthouseComparisonSchema,
  lighthouseInputSchema,
  lighthouseRunSchema,
  lighthouseSummarySchema,
  localRuntimeInputSchema,
  mergeLocalRuntimeInput,
  planGateSchema,
  planModeratorPrompt,
  planReviewPanelistSchema,
  planReviewSchema,
  planReviewerPrompt,
  remediationPlanPrompt,
  remediationPlanSchema,
  runLighthouseTarget,
  runVerification,
  serverReadinessSchema,
  targetPlanSchema,
  codebaseReviewSchema,
  approvalPolicySchema,
  humanApprovalSchema,
  implementationResultSchema,
  verificationResultSchema,
  implementationReviewPanelistSchema,
  implementationReviewSchema,
  finalReportReviewPrompt,
  finalReportReviewSchema,
  finalReportSchema,
  summarizeLighthouseRuns,
  type ApprovalPolicy,
  type FinalReport,
  type FinalReportReview,
  type HumanApproval,
  type ImplementationResult,
  type ImplementationReview,
  type PlanGate,
  type PlanReview,
  type RemediationPlan,
  type VerificationResult,
} from "../lib/lighthouse";

const { Workflow, Task, Sequence, Parallel, MergeQueue, Loop, outputs, smithers } = createSmithers({
  input: lighthouseInputSchema,
  targetPlanDraft: targetPlanSchema,
  localRuntimeInput: localRuntimeInputSchema,
  serverReadiness: serverReadinessSchema,
  targetPlan: targetPlanSchema,
  lighthouseRun: lighthouseRunSchema,
  lighthouseSummary: lighthouseSummarySchema,
  codebaseReview: codebaseReviewSchema,
  remediationPlan: remediationPlanSchema,
  planReviewPanelist: planReviewPanelistSchema,
  planReview: planReviewSchema,
  approvalPolicy: approvalPolicySchema,
  humanApproval: humanApprovalSchema,
  planGate: planGateSchema,
  implementationResult: implementationResultSchema,
  verificationResult: verificationResultSchema,
  implementationReviewPanelist: implementationReviewPanelistSchema,
  implementationReview: implementationReviewSchema,
  lighthouseComparison: lighthouseComparisonSchema,
  finalReportReview: finalReportReviewSchema,
  finalReport: finalReportSchema,
});

const PLAN_REVIEW_SLOTS = [0, 1, 2, 3, 4] as const;
const indexedNodeId = (base: string, index: number) => `${base}-${index}`;

export default smithers((ctx) => {
  const input = coerceLighthouseInput(ctx.input);
  const draftPlan = ctx.outputMaybe(outputs.targetPlanDraft, { nodeId: "target-plan-draft" });
  const readiness = ctx.latest(outputs.serverReadiness, "local-readiness-check");
  const localRuntimeInput = ctx.outputMaybe(outputs.localRuntimeInput, { nodeId: "missing-local-runtime" });
  const targetPlan = ctx.outputMaybe(outputs.targetPlan, { nodeId: "target-plan" });
  const localBaseline = ctx.outputMaybe(outputs.lighthouseRun, { nodeId: "local-baseline" });
  const prodBaseline = ctx.outputMaybe(outputs.lighthouseRun, { nodeId: "prod-baseline" });
  const baselineSummary = ctx.outputMaybe(outputs.lighthouseSummary, { nodeId: "baseline-summary" });
  const prodSummary = ctx.outputMaybe(outputs.lighthouseSummary, { nodeId: "prod-summary" });
  const codebaseReview = ctx.outputMaybe(outputs.codebaseReview, { nodeId: "codebase-review" });
  const implementationLoopIteration = ctx.iterations?.["implementation-review-loop"] ?? 0;
  const finalReportLoopIteration = ctx.iterations?.["final-report-review-loop"] ?? 0;

  const latestIndexedOutput = <T,>(table: unknown, baseNodeId: string): T | undefined => {
    for (let i = PLAN_REVIEW_SLOTS.length - 1; i >= 0; i -= 1) {
      const value = ctx.outputMaybe(table as never, { nodeId: indexedNodeId(baseNodeId, i) } as never) as
        | T
        | undefined;
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const indexedOutputCount = (table: unknown, baseNodeId: string) =>
    PLAN_REVIEW_SLOTS.filter(
      (slot) => ctx.outputMaybe(table as never, { nodeId: indexedNodeId(baseNodeId, slot) } as never) !== undefined,
    ).length;

  const remediationPlan = latestIndexedOutput<RemediationPlan>(outputs.remediationPlan, "draft-remediation-plan");
  const planReview = latestIndexedOutput<PlanReview>(outputs.planReview, "plan-review-moderator");
  const approvalPolicy = latestIndexedOutput<ApprovalPolicy>(outputs.approvalPolicy, "approval-policy");
  const humanApproval = latestIndexedOutput<HumanApproval>(outputs.humanApproval, "human-approval");
  const planGate = latestIndexedOutput<PlanGate>(outputs.planGate, "plan-gate");
  const implementationResult = ctx.latest(outputs.implementationResult, "implement-changes") as
    | ImplementationResult
    | undefined;
  const currentImplementationResult = ctx.outputMaybe(outputs.implementationResult, {
    nodeId: "implement-changes",
    iteration: implementationLoopIteration,
  });
  const verificationResult = ctx.latest(outputs.verificationResult, "verification") as VerificationResult | undefined;
  const currentVerificationResult = ctx.outputMaybe(outputs.verificationResult, {
    nodeId: "verification",
    iteration: implementationLoopIteration,
  });
  const currentImplementationCompletenessReview = ctx.outputMaybe(
    outputs.implementationReviewPanelist,
    { nodeId: "implementation-review-completeness", iteration: implementationLoopIteration },
  );
  const currentImplementationCodebaseFitReview = ctx.outputMaybe(
    outputs.implementationReviewPanelist,
    { nodeId: "implementation-review-codebase-fit", iteration: implementationLoopIteration },
  );
  const implementationReview = ctx.latest(outputs.implementationReview, "implementation-review-moderator") as
    | ImplementationReview
    | undefined;
  const afterSummary = ctx.latest(outputs.lighthouseSummary, "after-summary");
  const comparison = ctx.latest(outputs.lighthouseComparison, "compare-local");
  const finalReportDraft = ctx.latest(outputs.finalReport, "final-report-draft") as FinalReport | undefined;
  const currentFinalReportDraft = ctx.outputMaybe(outputs.finalReport, {
    nodeId: "final-report-draft",
    iteration: finalReportLoopIteration,
  }) as FinalReport | undefined;
  const finalReportReview = ctx.latest(outputs.finalReportReview, "final-report-review") as
    | FinalReportReview
    | undefined;
  const baselineFailed = baselineSummary !== undefined && baselineSummary.status !== "parsed";
  const implementationLoopSchedulerIterations = targetPlan ? targetPlan.maxImplementationReviewIterations * 8 + 8 : 8;

  const needsLocalHumanInput =
    draftPlan?.local.mode === "url" &&
    readiness !== undefined &&
    readiness.satisfied === false &&
    !localRuntimeInput;
  const canFinalizeTargetPlan =
    draftPlan !== undefined &&
    (draftPlan.local.mode !== "url" || readiness?.satisfied === true || localRuntimeInput !== undefined);
  const prodReady = prodBaseline !== undefined || targetPlan?.prod.enabled === false;
  const baselineReady = localBaseline !== undefined && prodReady;
  const planLoopDone = planGate?.ready === true;
  const planLoopBlocked =
    targetPlan !== undefined &&
    planGate !== undefined &&
    !planGate.ready &&
    indexedOutputCount(outputs.planGate, "plan-gate") >= targetPlan.maxPlanReviewIterations;
  const implementationLoopDone =
    targetPlan?.allowImplementation === false ||
    implementationReview?.approved === true ||
    implementationResult?.status === "skipped";
  const implementationLoopBlocked =
    targetPlan !== undefined &&
    implementationReview !== undefined &&
    !implementationReview.approved &&
    ctx.iterationCount(outputs.implementationReview, "implementation-review-moderator") >=
      targetPlan.maxImplementationReviewIterations;
  const shouldRunAfter =
    targetPlan?.allowImplementation === true &&
    implementationReview?.approved === true &&
    implementationReview.complete === true;
  const shouldCompare =
    baselineSummary !== undefined &&
    (afterSummary !== undefined ||
      targetPlan?.allowImplementation === false ||
      planLoopBlocked ||
      implementationLoopBlocked);
  const finalReady =
    baselineSummary !== undefined &&
    targetPlan !== undefined &&
    (comparison !== undefined || planLoopBlocked || implementationLoopBlocked || baselineFailed);
  const finalReportReviewCount = ctx.iterationCount(outputs.finalReportReview, "final-report-review");
  const finalReportReviewDone =
    finalReportReview?.approved === true || (targetPlan !== undefined && finalReportReviewCount >= 2);

  return (
    <Workflow name="lighthouse-check">
      <Sequence>
        <Task id="target-plan-draft" output={outputs.targetPlanDraft}>
          {() => createTargetPlan(input)}
        </Task>

        {draftPlan?.local.mode === "url" ? (
          <Poller
            id="local-readiness"
            checkOutput={outputs.serverReadiness}
            check={() => checkServerReady(draftPlan.local.baseUrl)}
            maxAttempts={3}
            intervalMs={1000}
            onTimeout="return-last"
          />
        ) : null}

        {needsLocalHumanInput ? (
          <HumanTask
            id="missing-local-runtime"
            output={outputs.localRuntimeInput}
            prompt={`The local URL ${draftPlan.local.baseUrl} was not reachable. Provide JSON with at least one of localUrl, localServeCommand, or staticDistDir so the workflow can run the required local Lighthouse check.`}
          />
        ) : null}

        {canFinalizeTargetPlan ? (
          <Task id="target-plan" output={outputs.targetPlan}>
            {() => mergeLocalRuntimeInput(input, localRuntimeInput)}
          </Task>
        ) : null}

        {targetPlan ? (
          <MergeQueue id="lighthouse-runs" maxConcurrency={1}>
            <Task id="local-baseline" output={outputs.lighthouseRun} timeoutMs={1000 * 60 * 30}>
              {() => runLighthouseTarget(targetPlan, "local", "baseline")}
            </Task>
            <Task id="prod-baseline" output={outputs.lighthouseRun} timeoutMs={1000 * 60 * 30}>
              {() => runLighthouseTarget(targetPlan, "prod", "baseline")}
            </Task>
          </MergeQueue>
        ) : null}

        {targetPlan && baselineReady ? (
          <Task id="baseline-summary" output={outputs.lighthouseSummary}>
            {() => summarizeLighthouseRuns("local", "baseline", [localBaseline])}
          </Task>
        ) : null}

        {targetPlan && prodBaseline ? (
          <Task id="prod-summary" output={outputs.lighthouseSummary}>
            {() => summarizeLighthouseRuns("prod", "baseline", [prodBaseline])}
          </Task>
        ) : null}

        {targetPlan && baselineSummary?.status === "parsed" ? (
          <Task id="codebase-review" output={outputs.codebaseReview} agent={CodexAgent} timeoutMs={1000 * 60 * 20}>
            {codebaseReviewPrompt(targetPlan, baselineSummary, prodSummary)}
          </Task>
        ) : null}

        {targetPlan && baselineSummary?.status === "parsed" && codebaseReview ? (
          <Sequence>
              {PLAN_REVIEW_SLOTS.slice(0, targetPlan.maxPlanReviewIterations).map((slot) => {
                const previousGate =
                  slot > 0
                    ? (ctx.outputMaybe(outputs.planGate, {
                        nodeId: indexedNodeId("plan-gate", slot - 1),
                      }) as PlanGate | undefined)
                    : undefined;
                const shouldRunSlot = slot === 0 || (previousGate !== undefined && !previousGate.ready);
                const slotPlan = ctx.outputMaybe(outputs.remediationPlan, {
                  nodeId: indexedNodeId("draft-remediation-plan", slot),
                }) as RemediationPlan | undefined;
                const slotCriticalityReview = ctx.outputMaybe(outputs.planReviewPanelist, {
                  nodeId: indexedNodeId("plan-review-criticality", slot),
                });
                const slotCodebaseFitReview = ctx.outputMaybe(outputs.planReviewPanelist, {
                  nodeId: indexedNodeId("plan-review-codebase-fit", slot),
                });
                const slotPlanReview = ctx.outputMaybe(outputs.planReview, {
                  nodeId: indexedNodeId("plan-review-moderator", slot),
                }) as PlanReview | undefined;
                const slotApprovalPolicy = ctx.outputMaybe(outputs.approvalPolicy, {
                  nodeId: indexedNodeId("approval-policy", slot),
                }) as ApprovalPolicy | undefined;
                const slotHumanApproval = ctx.outputMaybe(outputs.humanApproval, {
                  nodeId: indexedNodeId("human-approval", slot),
                }) as HumanApproval | undefined;
                const previousReview =
                  slot > 0
                    ? (ctx.outputMaybe(outputs.planReview, {
                        nodeId: indexedNodeId("plan-review-moderator", slot - 1),
                      }) as PlanReview | undefined)
                    : planReview;

                return shouldRunSlot ? (
                  <Sequence key={String(slot)}>
                  <Task
                    id={indexedNodeId("draft-remediation-plan", slot)}
                    output={outputs.remediationPlan}
                    agent={CodexAgent}
                    timeoutMs={1000 * 60 * 20}
                  >
                    {remediationPlanPrompt({
                      plan: targetPlan,
                      localSummary: baselineSummary,
                      prodSummary,
                      codebaseReview,
                      previousComparison: comparison,
                      previousGate: previousGate ?? planGate,
                      previousReview,
                      previousApproval: slotHumanApproval ?? humanApproval,
                    })}
                  </Task>

                  {slotPlan ? (
                    <Parallel id={indexedNodeId("plan-reviewers", slot)} maxConcurrency={2}>
                      <Task
                        id={indexedNodeId("plan-review-criticality", slot)}
                        output={outputs.planReviewPanelist}
                        agent={CodexAgent}
                        timeoutMs={1000 * 60 * 15}
                      >
                        {planReviewerPrompt("criticality", slotPlan, {
                          targetPlan,
                          baselineSummary,
                          prodSummary,
                          codebaseReview,
                          comparison,
                        })}
                      </Task>
                      <Task
                        id={indexedNodeId("plan-review-codebase-fit", slot)}
                        output={outputs.planReviewPanelist}
                        agent={CodexAgent}
                        timeoutMs={1000 * 60 * 15}
                      >
                        {planReviewerPrompt("codebase-fit", slotPlan, {
                          targetPlan,
                          baselineSummary,
                          prodSummary,
                          codebaseReview,
                          comparison,
                        })}
                      </Task>
                    </Parallel>
                  ) : null}

                  {slotPlan && slotCriticalityReview && slotCodebaseFitReview ? (
                    <Task
                      id={indexedNodeId("plan-review-moderator", slot)}
                      output={outputs.planReview}
                      agent={CodexAgent}
                      timeoutMs={1000 * 60 * 15}
                    >
                      {planModeratorPrompt({
                        criticalityReview: slotCriticalityReview,
                        codebaseFitReview: slotCodebaseFitReview,
                        plan: slotPlan,
                      })}
                    </Task>
                  ) : null}

                  {slotPlan && slotPlanReview ? (
                    <Task id={indexedNodeId("approval-policy", slot)} output={outputs.approvalPolicy}>
                      {() => determineApprovalPolicy(targetPlan, slotPlan, slotPlanReview)}
                    </Task>
                  ) : null}

                  {slotPlanReview && slotApprovalPolicy?.requiresHumanApproval ? (
                    <HumanTask
                      id={indexedNodeId("human-approval", slot)}
                      output={outputs.humanApproval}
                      prompt={humanApprovalPrompt({
                        plan: slotPlan!,
                        review: slotPlanReview,
                        policy: slotApprovalPolicy,
                      })}
                    />
                  ) : null}

                  {slotPlanReview &&
                  slotApprovalPolicy &&
                  (!slotApprovalPolicy.requiresHumanApproval || slotHumanApproval) ? (
                    <Task id={indexedNodeId("plan-gate", slot)} output={outputs.planGate}>
                      {() => evaluatePlanGate(slotPlanReview, slotApprovalPolicy, slotHumanApproval)}
                    </Task>
                  ) : null}
                </Sequence>
                ) : null;
              })}

              {planGate?.ready && targetPlan.allowImplementation ? (
                <Loop
                  id="implementation-review-loop"
                  until={implementationLoopDone || implementationLoopBlocked}
                  maxIterations={implementationLoopSchedulerIterations}
                  onMaxReached="return-last"
                >
                  <Sequence>
                    {remediationPlan && planReview ? (
                      <Task
                        id="implement-changes"
                        output={outputs.implementationResult}
                        agent={CodexAgent}
                        timeoutMs={1000 * 60 * 45}
                      >
                        {implementationPrompt({
                          plan: targetPlan,
                          remediationPlan,
                          review: planReview,
                        })}
                      </Task>
                    ) : null}

                    {currentImplementationResult ? (
                      <Task id="verification" output={outputs.verificationResult} timeoutMs={1000 * 60 * 30}>
                        {() => runVerification(targetPlan)}
                      </Task>
                    ) : null}

                    {currentImplementationResult && currentVerificationResult && remediationPlan ? (
                      <Parallel id="implementation-reviewers" maxConcurrency={2}>
                        <Task
                          id="implementation-review-completeness"
                          output={outputs.implementationReviewPanelist}
                          agent={CodexAgent}
                          timeoutMs={1000 * 60 * 15}
                        >
                          {implementationReviewerPrompt("completeness", {
                            targetPlan,
                            remediationPlan,
                            verification: currentVerificationResult,
                          })}
                        </Task>
                        <Task
                          id="implementation-review-codebase-fit"
                          output={outputs.implementationReviewPanelist}
                          agent={CodexAgent}
                          timeoutMs={1000 * 60 * 15}
                        >
                          {implementationReviewerPrompt("codebase-fit", {
                            targetPlan,
                            remediationPlan,
                            verification: currentVerificationResult,
                          })}
                        </Task>
                      </Parallel>
                    ) : null}

                    {currentImplementationResult &&
                    currentVerificationResult &&
                    currentImplementationCompletenessReview &&
                    currentImplementationCodebaseFitReview ? (
                      <Task
                        id="implementation-review-moderator"
                        output={outputs.implementationReview}
                        agent={CodexAgent}
                        timeoutMs={1000 * 60 * 15}
                      >
                        {implementationModeratorPrompt({
                          completenessReview: currentImplementationCompletenessReview,
                          codebaseFitReview: currentImplementationCodebaseFitReview,
                          verification: currentVerificationResult,
                        })}
                      </Task>
                    ) : null}
                  </Sequence>
                </Loop>
              ) : null}

              {shouldRunAfter ? (
                <MergeQueue id="lighthouse-after-runs" maxConcurrency={1}>
                  <Task id="local-after" output={outputs.lighthouseRun} timeoutMs={1000 * 60 * 30}>
                    {() => runLighthouseTarget(targetPlan, "local", "after")}
                  </Task>
                </MergeQueue>
              ) : null}

              {shouldRunAfter && ctx.latest(outputs.lighthouseRun, "local-after") ? (
                <Task id="after-summary" output={outputs.lighthouseSummary}>
                  {() =>
                    summarizeLighthouseRuns("local", "after", [
                      ctx.latest(outputs.lighthouseRun, "local-after")!,
                    ])
                  }
                </Task>
              ) : null}

              {shouldCompare ? (
                <Task id="compare-local" output={outputs.lighthouseComparison}>
                  {() => {
                    if (planLoopBlocked) {
                      return {
                        status: "blocked",
                        greatEnough: false,
                        categoryDeltas: {},
                        metricDeltas: {},
                        improvements: [],
                        regressions: [],
                        remainingIssues: planGate?.feedbackForNextPlan ?? [],
                        recommendation: "Plan review or human approval did not converge within the configured limit.",
                      };
                    }
                    if (implementationLoopBlocked) {
                      return {
                        status: "blocked",
                        greatEnough: false,
                        categoryDeltas: {},
                        metricDeltas: {},
                        improvements: [],
                        regressions: [],
                        remainingIssues: implementationReview?.requiredChanges ?? [],
                        recommendation: "Implementation review did not converge within the configured limit.",
                      };
                    }
                    return compareLighthouseSummaries(targetPlan, baselineSummary, afterSummary);
                  }}
                </Task>
              ) : null}
          </Sequence>
        ) : null}

        {finalReady ? (
          <Loop id="final-report-review-loop" until={finalReportReviewDone} maxIterations={2} onMaxReached="return-last">
            <Sequence>
              <Task id="final-report-draft" output={outputs.finalReport}>
                {() =>
                  buildAndWriteFinalReportDraft({
                    plan: targetPlan,
                    baseline: baselineSummary,
                    prodSummary,
                    after: afterSummary,
                    comparison,
                    verification: verificationResult,
                    implementationReview,
                    implementationResult,
                    codebaseReview,
                    remediationPlan,
                    planReview,
                    approvalPolicy,
                    humanApproval,
                    planGate,
                    previousReview: finalReportReview,
                  })
                }
              </Task>

              {currentFinalReportDraft && finalReportReviewCount < 2 ? (
                <Task
                  id="final-report-review"
                  output={outputs.finalReportReview}
                  agent={CodexAgent}
                  timeoutMs={1000 * 60 * 15}
                >
                  {finalReportReviewPrompt({
                    draft: currentFinalReportDraft,
                    targetPlan,
                    baselineSummary,
                    prodSummary,
                    codebaseReview,
                    remediationPlan,
                    planReview,
                    comparison,
                  })}
                </Task>
              ) : null}
            </Sequence>
          </Loop>
        ) : null}

      </Sequence>
    </Workflow>
  );
});
