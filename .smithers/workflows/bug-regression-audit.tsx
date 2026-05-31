// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Bug Regression Audit
// smithers-description: Audit local code changes for likely accidental bugs using structured diff bundles, evidence-backed specialist review, and confidence scoring.
// smithers-tags: bugbot, regression-audit, code-review, testing, local-diff
/** @jsxImportSource smithers-orchestrator */
import {
  CheckSuite,
  ClassifyAndRoute,
  Debate,
  GatherAndSynthesize,
  Panel,
  createSmithers,
} from "smithers-orchestrator";
import {
  buildAuditReport,
  buildDiffIntake,
  bugRegressionAuditSchemas,
  categories,
  contextPrompt,
  contextSourceNames,
  contextSynthesisPrompt,
  createBugAuditAgents,
  deepPanelPrompt,
  fallbackValidation,
  feedbackMemoryPrompt,
  findingSynthesisPrompt,
  hunterDefinitions,
  hunterPrompt,
  quickValidationPrompt,
  riskClassificationPrompt,
  routePrompt,
  rulesRecallPrompt,
  changeMapPrompt,
  runValidationChecks,
  validatorTopic,
} from "../components/bug-regression-audit";

const { Workflow, Task, Sequence, Parallel, outputs, smithers } = createSmithers(
  bugRegressionAuditSchemas,
  {
    readableName: "Bug Regression Audit",
    description: "Audit local code changes for likely accidental bugs using structured diff bundles and evidence-backed specialist review.",
  },
);

const memoryNamespace = { kind: "workflow" as const, id: "bug-regression-audit" };

const present = <T,>(value: T | null | undefined): value is T => value != null;
const categoryPriority = new Map(categories.map((category, index) => [category, index]));
const riskWeight = { high: 3, medium: 2, low: 1 } as const;

export default smithers((ctx) => {
  const intake = ctx.outputMaybe(outputs.diffIntake, { nodeId: "diff-intake" });
  const changeMap = ctx.outputMaybe(outputs.changeMap, { nodeId: "change-map" });
  const rulesRecall = ctx.outputMaybe(outputs.rulesRecall, { nodeId: "rules-recall" });
  const classification = ctx.outputMaybe(outputs.riskClassification, { nodeId: "risk-classification-classify" });
  const checks = ctx.outputMaybe(outputs.checkEvidence, { nodeId: "check-evidence" });
  const contextBundle = ctx.outputMaybe(outputs.contextBundle, { nodeId: "context-gather-synthesize" });
  const deepPanel = ctx.outputMaybe(outputs.candidateBatch, { nodeId: "deep-panel-moderator" });
  const synthesized = ctx.outputMaybe(outputs.synthesizedFindings, { nodeId: "finding-synthesis" });
  const validation =
    ctx.outputMaybe(outputs.validationReport, { nodeId: "validator-judge" }) ??
    ctx.outputMaybe(outputs.validationReport, { nodeId: "validator-fallback" });
  const report = ctx.outputMaybe(outputs.auditReport, { nodeId: "report" });
  const agentCwd = intake?.repoRoot ?? process.cwd();
  const { BugAuditAgent, BugHunterAgent, BugModeratorAgent, BugSkepticAgent } =
    createBugAuditAgents(agentCwd);
  const requestedAuditMode =
    ctx.input.auditMode === "quick" || ctx.input.auditMode === "standard" || ctx.input.auditMode === "deep"
      ? ctx.input.auditMode
      : "standard";
  const auditMode = intake?.auditConfig.auditMode ?? requestedAuditMode;
  const includeUncommitted =
    typeof ctx.input.includeUncommitted === "boolean" ? ctx.input.includeUncommitted : true;

  const isAuditable =
    intake?.baselineStatus === "resolved" &&
    intake.diffBundle.files.length > 0;

  const needsRouteReviews = auditMode !== "quick";
  const routeReviews = needsRouteReviews
    ? classification?.classifications
        .map((item, index) =>
          ctx.outputMaybe(outputs.categoryReview, {
            nodeId: `risk-classification-route-${item.itemId || index}`,
          }),
        )
        .filter(present) ?? []
    : [];
  const routesComplete = classification
    ? !needsRouteReviews || routeReviews.length === classification.classifications.length
    : false;

  const activeContextSourceNames =
    classification && auditMode === "quick"
      ? contextSourceNames.filter((sourceName) => sourceName !== "runtime")
      : contextSourceNames;

  const gatheredContext: Record<string, unknown> = {};
  for (const sourceName of activeContextSourceNames) {
    const sourceOutput = ctx.outputMaybe(outputs.contextGather, {
      nodeId: `context-gather-gather-${sourceName}`,
    });
    if (sourceOutput) {
      gatheredContext[sourceName] = sourceOutput;
    }
  }
  const allContextGathered = activeContextSourceNames.every((sourceName) => gatheredContext[sourceName]);

  const classifiedCategories = new Set(classification?.classifications.map((item) => item.category) ?? []);
  const quickHunterCategories: string[] = classification
    ? [...classifiedCategories]
        .filter((category) => category !== "test-gap" && category !== "unknown")
        .sort((left, right) => {
          const leftRisk = Math.max(
            0,
            ...classification.classifications
              .filter((item) => item.category === left)
              .map((item) => riskWeight[item.riskLevel]),
          );
          const rightRisk = Math.max(
            0,
            ...classification.classifications
              .filter((item) => item.category === right)
              .map((item) => riskWeight[item.riskLevel]),
          );
          return rightRisk - leftRisk || (categoryPriority.get(left) ?? 99) - (categoryPriority.get(right) ?? 99);
        })
        .slice(0, 3)
    : [];

  const activeHunters = classification
    ? hunterDefinitions.filter((hunter) => {
        if (auditMode === "deep") return true;
        if (auditMode === "quick") {
          return quickHunterCategories.length > 0
            ? quickHunterCategories.includes(hunter.category)
            : classifiedCategories.has(hunter.category);
        }
        if (classifiedCategories.has(hunter.category)) return true;
        return hunter.category === "correctness";
      })
    : hunterDefinitions;

  const hunterBatches = activeHunters
    .map((hunter) => ctx.outputMaybe(outputs.candidateBatch, { nodeId: `hunter-${hunter.id}` }))
    .filter(present);
  const huntersComplete = contextBundle ? hunterBatches.length === activeHunters.length : false;
  const needsDeepPanel = auditMode === "deep";
  const canSynthesize = huntersComplete && (!needsDeepPanel || Boolean(deepPanel));

  const routeCategories = Object.fromEntries(
    categories.map((category) => [
      category,
      {
        agent: BugAuditAgent,
        output: outputs.categoryReview,
        prompt: (item: unknown) => {
          if (!intake) {
            throw new Error("routePrompt requires diff intake");
          }
          return routePrompt(item, ctx.input, intake, changeMap, rulesRecall);
        },
      },
    ]),
  );

  const contextSources = intake
    ? Object.fromEntries(
        activeContextSourceNames.map((sourceName) => [
          sourceName,
          {
            agent: BugAuditAgent,
            output: outputs.contextGather,
            prompt: contextPrompt(sourceName, ctx.input, intake, changeMap, rulesRecall, routeReviews),
          },
        ]),
      )
    : {};

  const configuredChecks = Array.isArray(ctx.input.checkCommands) ? ctx.input.checkCommands : [];
  const checkCommands = [...new Set(["git diff --check", ...configuredChecks])];
  const checkSuiteChecks = checkCommands.map((command, index) => ({
    id: `check-${index + 1}`,
    command,
    label: command,
  }));

  return (
    <Workflow name="bug-regression-audit">
      <Sequence>
        <Task id="diff-intake" output={outputs.diffIntake} noRetry>
          {() => buildDiffIntake(ctx.input)}
        </Task>

        {intake ? (
          <Task id="check-evidence" output={outputs.checkEvidence} noRetry>
            {() => runValidationChecks(ctx.input, intake)}
          </Task>
        ) : null}

        {intake ? (
          // Smithers 0.21 exposes CheckSuite, but its generated text output is not yet
          // compatible with this workflow's typed schema contract. The structured,
          // executable check path is the check-evidence task above.
          <CheckSuite
            id="check-suite"
            checks={checkSuiteChecks}
            verdictOutput={outputs.checkEvidence}
            strategy="all-pass"
            maxConcurrency={2}
            continueOnFail
            skipIf
          />
        ) : null}

        {intake && !isAuditable ? (
          <Task id="validator-fallback" output={outputs.validationReport} noRetry>
            {{
              ...fallbackValidation(
                intake.baselineStatus === "resolved"
                  ? "No reviewable text hunks were found in the resolved diff scope."
                  : "The audit is inconclusive because no baseline could be resolved.",
              ),
              verdict: intake.baselineStatus === "resolved" ? "no_clear_bugs" : "inconclusive",
            }}
          </Task>
        ) : null}

        {intake && isAuditable ? (
          <Task id="change-map" output={outputs.changeMap} agent={BugAuditAgent} retries={1}>
            {changeMapPrompt(ctx.input, intake)}
          </Task>
        ) : null}

        {intake && isAuditable ? (
          <Task
            id="rules-recall"
            output={outputs.rulesRecall}
            agent={BugAuditAgent}
            retries={1}
            memory={{
              recall: {
                namespace: memoryNamespace,
                query: `repo:${intake.repoRoot} changed:${intake.changedFiles.map((file) => file.path).join(",")}`,
                topK: 8,
              },
            }}
          >
            {rulesRecallPrompt(ctx.input, intake)}
          </Task>
        ) : null}

        {intake && changeMap && rulesRecall && auditMode === "quick" ? (
          <Task id="risk-classification-classify" output={outputs.riskClassification} agent={BugAuditAgent} retries={1}>
            {riskClassificationPrompt(ctx.input, intake, changeMap, rulesRecall)}
          </Task>
        ) : null}

        {intake && changeMap && rulesRecall && auditMode !== "quick" ? (
          <ClassifyAndRoute
            id="risk-classification"
            items={changeMap.changedFiles}
            categories={routeCategories}
            classifierAgent={BugAuditAgent}
            classifierOutput={outputs.riskClassification}
            routeOutput={outputs.categoryReview}
            classificationResult={classification ?? null}
            maxConcurrency={4}
          >
            {riskClassificationPrompt(ctx.input, intake, changeMap, rulesRecall)}
          </ClassifyAndRoute>
        ) : null}

        {intake && changeMap && rulesRecall && classification && routesComplete ? (
          <GatherAndSynthesize
            id="context-gather"
            sources={contextSources}
            synthesizer={BugModeratorAgent}
            gatherOutput={outputs.contextGather}
            synthesisOutput={outputs.contextBundle}
            gatheredResults={allContextGathered ? gatheredContext : null}
            synthesisPrompt={contextSynthesisPrompt(allContextGathered ? gatheredContext : null)}
            maxConcurrency={4}
          />
        ) : null}

        {intake && changeMap && rulesRecall && contextBundle ? (
          <Parallel id="bug-hunters" maxConcurrency={auditMode === "quick" ? 3 : 6}>
            {activeHunters.map((hunter) => (
              <Task
                key={hunter.id}
                id={`hunter-${hunter.id}`}
                output={outputs.candidateBatch}
                agent={BugHunterAgent}
                retries={1}
              >
                {hunterPrompt(hunter, ctx.input, intake, changeMap, rulesRecall, contextBundle, routeReviews, checks)}
              </Task>
            ))}
          </Parallel>
        ) : null}

        {intake && contextBundle && huntersComplete && needsDeepPanel ? (
          <Panel
            id="deep-panel"
            panelists={[
              { agent: BugHunterAgent, role: "failure-mode reviewer", label: "failure-mode" },
              { agent: BugSkepticAgent, role: "false-positive reviewer", label: "false-positive" },
              { agent: BugAuditAgent, role: "testability reviewer", label: "testability" },
            ]}
            moderator={BugModeratorAgent}
            panelistOutput={outputs.candidateBatch}
            moderatorOutput={outputs.candidateBatch}
            strategy="synthesize"
            maxConcurrency={3}
          >
            {deepPanelPrompt(ctx.input, intake, { candidateBatches: hunterBatches }, contextBundle)}
          </Panel>
        ) : null}

        {intake && canSynthesize ? (
          <Task id="finding-synthesis" output={outputs.synthesizedFindings} agent={BugModeratorAgent} retries={1}>
            {findingSynthesisPrompt(ctx.input, hunterBatches, deepPanel, checks)}
          </Task>
        ) : null}

        {intake && synthesized && synthesized.candidateFindings.length === 0 ? (
          <Task id="validator-fallback" output={outputs.validationReport} noRetry>
            {{
              verdict: "no_clear_bugs",
              summary: synthesized.summary || "No credible candidate regression bugs were found.",
              findings: [],
              discardedFindings: synthesized.discardedCandidates,
              coverageGaps: synthesized.coverageGaps,
              learnedRuleCandidates: synthesized.learnedRuleCandidates,
              limitations: synthesized.limitations,
            }}
          </Task>
        ) : null}

        {intake && synthesized && synthesized.candidateFindings.length > 0 && auditMode === "quick" ? (
          <Task id="validator-judge" output={outputs.validationReport} agent={BugSkepticAgent} retries={1}>
            {quickValidationPrompt(ctx.input, intake, synthesized, checks)}
          </Task>
        ) : null}

        {intake && synthesized && synthesized.candidateFindings.length > 0 && auditMode !== "quick" ? (
          <Debate
            id="validator"
            proposer={BugHunterAgent}
            opponent={BugSkepticAgent}
            judge={BugModeratorAgent}
            rounds={auditMode === "deep" ? 2 : 1}
            argumentOutput={outputs.validationArgument}
            verdictOutput={outputs.validationReport}
            topic={validatorTopic(ctx.input, intake, synthesized, checks)}
          />
        ) : null}

        {intake && checks && validation ? (
          <Task id="report" output={outputs.auditReport} noRetry>
            {() => buildAuditReport(ctx.input, intake, validation, checks)}
          </Task>
        ) : null}

        {report ? (
          <Task id="final-output" output={outputs.output} noRetry>
            {report}
          </Task>
        ) : null}

        {report && ctx.input.feedback ? (
          <Task
            id="feedback-memory-update"
            output={outputs.feedbackMemoryUpdate}
            agent={BugAuditAgent}
            retries={1}
            memory={{
              remember: {
                namespace: memoryNamespace,
                key: `feedback-${ctx.runId}`,
              },
            }}
          >
            {feedbackMemoryPrompt(ctx.input, report)}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
