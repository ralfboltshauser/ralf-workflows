import type {
  CandidateBatch,
  CheckEvidence,
  DiffIntake,
  ValidationReport,
  WorkflowInput,
} from "./schemas";
import type { HunterDefinition } from "./hunters";

export const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const compactText = (value: unknown, max = 8_000) => {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
};

const compactList = (value: unknown, maxItems = 12, maxText = 700) =>
  Array.isArray(value) ? value.slice(0, maxItems).map((item) => compactText(item, maxText)) : [];

const compactInput = (input: WorkflowInput) => ({
  repoPath: input.repoPath,
  baseRef: input.baseRef ?? null,
  headRef: input.headRef,
  includeUncommitted: input.includeUncommitted,
  auditMode: input.auditMode,
  maxFindings: input.maxFindings,
  outputDir: input.outputDir,
  checkCommands: input.checkCommands,
  feedbackPresent: Boolean(input.feedback),
});

const compactIntake = (intake: DiffIntake, opts: { includeDiff?: boolean } = {}) => ({
  repoPath: intake.repoPath,
  repoRoot: intake.repoRoot,
  currentBranch: intake.currentBranch,
  requestedBaseRef: intake.requestedBaseRef,
  requestedHeadRef: intake.requestedHeadRef,
  resolvedBaseRef: intake.resolvedBaseRef,
  resolvedBaseCommit: intake.resolvedBaseCommit,
  resolvedHeadRef: intake.resolvedHeadRef,
  resolvedHeadCommit: intake.resolvedHeadCommit,
  baseResolution: intake.baseResolution,
  baselineStatus: intake.baselineStatus,
  includeUncommitted: intake.includeUncommitted,
  hasUncommittedChanges: intake.hasUncommittedChanges,
  untrackedFiles: compactList(intake.untrackedFiles, 20, 240),
  changedFiles: intake.changedFiles.slice(0, 40),
  diffSummary: compactText(intake.diffSummary, 6_000),
  unifiedDiff: opts.includeDiff ? compactText(intake.unifiedDiff, 55_000) : undefined,
  diffTruncated: intake.diffTruncated,
  limitations: compactList(intake.limitations, 8, 500),
});

const compactChangedFile = (file: Record<string, unknown>) => ({
  path: file.path,
  status: file.status,
  likelyBehaviorChange: compactText(file.likelyBehaviorChange, 900),
  symbols: compactList(file.symbols, 10, 160),
  riskCategories: file.riskCategories,
  nearbyTests: compactList(file.nearbyTests, 8, 220),
  contractsOrSchemas: compactList(file.contractsOrSchemas, 8, 220),
  runtimeSurfaces: compactList(file.runtimeSurfaces, 8, 220),
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const compactChangeMap = (value: unknown) => {
  const record = asRecord(value);
  return {
    summary: compactText(record.summary, 1_500),
    changedFiles: Array.isArray(record.changedFiles)
      ? record.changedFiles.slice(0, 20).map((file) => compactChangedFile(asRecord(file)))
      : [],
    crossFileRisks: compactList(record.crossFileRisks, 10, 500),
    testSurface: compactList(record.testSurface, 10, 500),
    likelyBlastRadius: compactList(record.likelyBlastRadius, 10, 500),
    assumptions: compactList(record.assumptions, 8, 400),
    limitations: compactList(record.limitations, 8, 400),
  };
};

const compactRules = (value: unknown) => {
  const record = asRecord(value);
  return {
    appliedRules: compactList(record.appliedRules, 8, 500),
    antiRules: compactList(record.antiRules, 8, 500),
    priorAcceptedPatterns: compactList(record.priorAcceptedPatterns, 8, 500),
    priorDismissedPatterns: compactList(record.priorDismissedPatterns, 8, 500),
    memoryLimitations: compactList(record.memoryLimitations, 6, 400),
  };
};

const compactContextBundle = (value: unknown) => {
  const record = asRecord(value);
  return {
    summary: compactText(record.summary, 1_500),
    filesRead: compactList(record.filesRead, 24, 240),
    callsites: compactList(record.callsites, 12, 500),
    tests: compactList(record.tests, 12, 500),
    contracts: compactList(record.contracts, 12, 500),
    runtimeSurfaces: compactList(record.runtimeSurfaces, 12, 500),
    highRiskAreas: compactList(record.highRiskAreas, 10, 600),
    limitations: compactList(record.limitations, 8, 400),
  };
};

const compactContextGather = (value: unknown) => {
  const record = asRecord(value);
  const snippets = Array.isArray(record.relevantSnippets)
    ? record.relevantSnippets.slice(0, 8).map((snippet) => {
        const item = asRecord(snippet);
        return {
          file: item.file,
          lineStart: item.lineStart,
          lineEnd: item.lineEnd,
          summary: compactText(item.summary, 450),
        };
      })
    : [];
  return {
    sourceName: record.sourceName,
    filesRead: compactList(record.filesRead, 18, 240),
    keyEvidence: compactList(record.keyEvidence, 10, 650),
    relevantSnippets: snippets,
    limitations: compactList(record.limitations, 6, 400),
  };
};

const compactContextResults = (value: Record<string, unknown> | null) =>
  Object.fromEntries(Object.entries(value ?? {}).map(([key, result]) => [key, compactContextGather(result)]));

const compactRouteReviews = (value: unknown[]) =>
  value.slice(0, 8).map((item) => {
    const record = asRecord(item);
    return {
      itemId: record.itemId,
      category: record.category,
      riskLevel: record.riskLevel,
      observations: compactList(record.observations, 6, 450),
      recommendedContext: compactList(record.recommendedContext, 6, 300),
      hunterPromptAdditions: compactList(record.hunterPromptAdditions, 6, 300),
    };
  });

const compactChecks = (checks: CheckEvidence | undefined) =>
  checks
    ? {
        summary: checks.summary,
        commandsRun: checks.commandsRun.map((check) => ({
          command: check.command,
          result: check.result,
          exitCode: check.exitCode,
          summary: compactText(check.summary, 500),
        })),
        skippedCommands: checks.skippedCommands,
        limitations: checks.limitations,
      }
    : null;

const compactFinding = (value: unknown) => {
  const record = asRecord(value);
  return {
    id: record.id,
    title: record.title,
    severity: record.severity,
    confidence: record.confidence,
    category: record.category,
    affectedFiles: Array.isArray(record.affectedFiles) ? record.affectedFiles.slice(0, 12) : [],
    bugHypothesis: compactText(record.bugHypothesis, 700),
    evidence: compactText(record.evidence, 900),
    whyThisIsNewOrRegressionRisk: compactText(record.whyThisIsNewOrRegressionRisk, 500),
    reproductionIdea: compactText(record.reproductionIdea, 450),
    suggestedTest: compactText(record.suggestedTest, 450),
    suggestedFixDirection: compactText(record.suggestedFixDirection, 500),
  };
};

const compactCandidateBatch = (value: unknown) => {
  const record = asRecord(value);
  return {
    source: record.source,
    category: record.category,
    summary: compactText(record.summary, 700),
    candidates: Array.isArray(record.candidates) ? record.candidates.slice(0, 3).map(compactFinding) : [],
    weakSignals: compactList(record.weakSignals, 5, 450),
    discardedSignals: Array.isArray(record.discardedSignals) ? record.discardedSignals.slice(0, 6) : [],
    coverageGaps: Array.isArray(record.coverageGaps) ? record.coverageGaps.slice(0, 6) : [],
    learnedRuleCandidates: Array.isArray(record.learnedRuleCandidates)
      ? record.learnedRuleCandidates.slice(0, 5)
      : [],
  };
};

const compactCandidateBatches = (batches: CandidateBatch[]) => batches.map(compactCandidateBatch);

const compactSynthesized = (value: unknown) => {
  const record = asRecord(value);
  return {
    summary: compactText(record.summary, 900),
    candidateFindings: Array.isArray(record.candidateFindings)
      ? record.candidateFindings.slice(0, 8).map(compactFinding)
      : [],
    discardedCandidates: Array.isArray(record.discardedCandidates) ? record.discardedCandidates.slice(0, 10) : [],
    coverageGaps: Array.isArray(record.coverageGaps) ? record.coverageGaps.slice(0, 8) : [],
    learnedRuleCandidates: Array.isArray(record.learnedRuleCandidates)
      ? record.learnedRuleCandidates.slice(0, 6)
      : [],
    limitations: compactList(record.limitations, 8, 400),
  };
};

const auditMethod = `
Audit method:
- Treat the diff as the primary evidence. Fetch extra context only when needed to prove or disprove a bug.
- Prefer concrete regression hypotheses over broad code review comments.
- A finding must tie changed code to user-visible behavior, data integrity, security/permission behavior, API contract behavior, or missing focused coverage.
- Do not propose style, maintainability, or refactor-only comments as bugs.
- Do not modify source files.
- Do not browse the web.
- Keep structured outputs concise: cap evidence arrays to the strongest items, avoid repeating the same snippet across fields, and keep long prose fields to a few sentences.
`;

export const changeMapPrompt = (input: WorkflowInput, intake: DiffIntake) => `
You are mapping the behavioral surface of a local code change before a regression audit.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake, { includeDiff: true }))}

Work:
1. Inspect the changed files and nearby code as needed.
2. Identify the likely behavior changes, symbols touched, nearby tests, contracts, schemas, runtime surfaces, and cross-file risks.
3. Keep the output evidence-based. Use empty arrays where context is not found.
`;

export const rulesRecallPrompt = (input: WorkflowInput, intake: DiffIntake) => `
Recall explicit bug-audit rules, anti-rules, accepted findings, dismissed false positives, and missed-bug patterns for this repository.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Repository scope:
${formatJson({
  repoRoot: intake.repoRoot,
  currentBranch: intake.currentBranch,
  changedFiles: intake.changedFiles.map((file) => file.path),
})}

If no relevant memory is available, return empty arrays and explain that in memoryLimitations.
Only include rules that help evaluate this diff.
`;

export const riskClassificationPrompt = (input: WorkflowInput, intake: DiffIntake, changeMap: unknown, rules: unknown) => `
Classify changed files and hunks into regression-risk categories.

${auditMethod}

Categories:
- correctness
- api-contract
- state-data
- async-concurrency
- security-permissions
- test-gap
- unknown

Input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake))}

Change map:
${formatJson(compactChangeMap(changeMap))}

Rules and anti-rules:
${formatJson(compactRules(rules))}

Return classifications with stable itemId values. Prefer one classification per coherent risk area, not one per file when files are coupled.
`;

export const routePrompt = (item: unknown, input: WorkflowInput, intake: DiffIntake, changeMap: unknown, rules: unknown) => `
Prepare a focused route review for this classified risk area.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Repository root:
${intake.repoRoot}

Diff intake:
${formatJson({
  repoRoot: intake.repoRoot,
  changedFiles: intake.changedFiles,
  diffSummary: intake.diffSummary,
  diffTruncated: intake.diffTruncated,
})}

Change map:
${formatJson(compactChangeMap(changeMap))}

Rules and anti-rules:
${formatJson(compactRules(rules))}

Classified item:
${formatJson(item)}

Before returning, inspect files relative to the repository root above. Do not inspect the workflow-pack repository unless it is the audited repo.
Return observations, recommended context to gather, and prompt additions that should guide the specialist bug hunters.
`;

export const contextPrompt = (
  sourceName: string,
  input: WorkflowInput,
  intake: DiffIntake,
  changeMap: unknown,
  rules: unknown,
  routeReviews: unknown[],
) => `
Gather only the ${sourceName} context needed to validate regression risks in this diff.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson({
  repoRoot: intake.repoRoot,
  changedFiles: intake.changedFiles,
  diffSummary: intake.diffSummary,
  diffTruncated: intake.diffTruncated,
})}

Change map:
${formatJson(compactChangeMap(changeMap))}

Rules:
${formatJson(compactRules(rules))}

Route reviews:
${formatJson(compactRouteReviews(routeReviews))}

Context source guidance:
- callers: callsites, imports, routes, consumers, background jobs, and entry points.
- tests: nearby tests, fixtures, snapshots, e2e coverage, and obvious missing regression tests.
- contracts: public APIs, schemas, migrations, config contracts, type declarations, generated clients, and docs.
- runtime: deployment, env/config, queues, caches, persistence, auth, permissions, and observability clues.

Return concise evidence with file references. Do not read unrelated large files.
`;

export const contextSynthesisPrompt = (gatheredResults: Record<string, unknown> | null) => `
Synthesize the gathered context into a compact bug-audit context bundle.

${auditMethod}

Gathered context:
${formatJson(compactContextResults(gatheredResults))}

Highlight the evidence that a bug hunter should use to prove or disprove candidate regressions.
`;

export const hunterPrompt = (
  hunter: HunterDefinition,
  input: WorkflowInput,
  intake: DiffIntake,
  changeMap: unknown,
  rules: unknown,
  contextBundle: unknown,
  routeReviews: unknown[],
  checks: CheckEvidence | undefined,
) => `
You are the ${hunter.title}.

${auditMethod}

Specialist focus:
${hunter.focus}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake))}

Change map:
${formatJson(compactChangeMap(changeMap))}

Rules and anti-rules:
${formatJson(compactRules(rules))}

Context bundle:
${formatJson(compactContextBundle(contextBundle))}

Route reviews:
${formatJson(compactRouteReviews(routeReviews))}

Validation checks:
${formatJson(compactChecks(checks))}

Return a candidate batch. Use stable finding ids like "${hunter.id}-001".
Only put concrete bug hypotheses in candidates. Put weaker leads in weakSignals or discardedSignals.
`;

export const deepPanelPrompt = (
  input: WorkflowInput,
  intake: DiffIntake,
  synthesized: unknown,
  contextBundle: unknown,
) => `
Independently review the highest-risk candidate findings from a deep regression-audit perspective.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake))}

Context bundle:
${formatJson(compactContextBundle(contextBundle))}

Synthesized candidate findings:
${formatJson(compactSynthesized(synthesized))}

Return a candidate batch containing only findings or dismissals that add new evidence.
`;

export const findingSynthesisPrompt = (
  input: WorkflowInput,
  batches: CandidateBatch[],
  deepPanel: CandidateBatch | undefined,
  checks: CheckEvidence | undefined,
) => {
  const maxFindings = typeof input.maxFindings === "number" ? input.maxFindings : 10;
  return `
Cluster, deduplicate, and normalize candidate regression findings.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Candidate batches:
${formatJson(compactCandidateBatches(batches))}

Deep panel result:
${formatJson(deepPanel ? compactCandidateBatch(deepPanel) : null)}

Validation checks:
${formatJson(compactChecks(checks))}

Keep at most ${maxFindings} candidateFindings. Preserve the strongest evidence and downgrade unsupported items to discardedCandidates.
`;
};

export const validatorTopic = (
  input: WorkflowInput,
  intake: DiffIntake,
  synthesized: unknown,
  checks: CheckEvidence | undefined,
) => `
Validate whether these candidate findings are real likely regressions introduced by the diff.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake))}

Synthesized candidates:
${formatJson(compactSynthesized(synthesized))}

Validation checks:
${formatJson(compactChecks(checks))}

Judging rules:
- Keep a finding only if it has changed-code evidence and a plausible failure mode.
- Discard items that are pre-existing, speculative, only missing style polish, or not tied to the diff.
- If evidence is mixed, downgrade confidence and explain limitations.
- Rank retained findings by severity, confidence, blast radius, and reproducibility.
`;

export const quickValidationPrompt = (
  input: WorkflowInput,
  intake: DiffIntake,
  synthesized: unknown,
  checks: CheckEvidence | undefined,
) => `
Validate these synthesized candidate findings for quick-mode regression audit.

${auditMethod}

Workflow input:
${formatJson(compactInput(input))}

Diff intake:
${formatJson(compactIntake(intake))}

Synthesized candidates:
${formatJson(compactSynthesized(synthesized))}

Validation checks:
${formatJson(compactChecks(checks))}

Act as a skeptical judge:
- Keep a finding only when changed-code evidence and failure mode are concrete.
- Move speculative, duplicate, pre-existing, or style-only items to discardedFindings.
- Preserve useful coverage gaps separately from bug findings.
- Use "likely regression" wording unless a check directly reproduced the bug.
`;

export const fallbackValidation = (reason: string): ValidationReport => ({
  verdict: "inconclusive",
  summary: reason,
  findings: [],
  discardedFindings: [],
  coverageGaps: [],
  learnedRuleCandidates: [],
  limitations: [reason],
});

export const feedbackMemoryPrompt = (input: WorkflowInput, report: unknown) => `
Convert explicit audit feedback into future bug-audit memory.

${auditMethod}

Feedback:
${formatJson(input.feedback ?? {})}

Final report:
${formatJson(report)}

Create rememberedRules from accepted findings, missed bug notes, and manual rule edits.
Create rememberedAntiRules from dismissed findings and false-positive notes.
Do not infer memory from silence.
`;
