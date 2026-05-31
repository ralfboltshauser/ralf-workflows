// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Cyber Security Audit
// smithers-description: Run a read-only cyber security audit and write a markdown report covering architecture, assets, CIA impact, code, supply chain, CI/CD, runtime, and AI-generated code.
// smithers-tags: cyber-security, audit, appsec, threat-modeling, devsecops, ai-code, read-only, report-only
/** @jsxImportSource smithers-orchestrator */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { CodexAgent as SmithersCodexAgent, MergeQueue, createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { CodexAgent } from "../agents";

const stringList = z.array(z.string());
const nonEmptyStringList = z.array(z.string()).min(1);
const ciaAxis = z.enum(["confidentiality", "integrity", "availability"]);
const ciaAxisList = z.array(ciaAxis).min(1);
const impactLevel = z.enum(["none", "low", "medium", "high", "critical"]);

const baseCodexConfig =
  CodexAgent.opts.config && !Array.isArray(CodexAgent.opts.config)
    ? CodexAgent.opts.config
    : {};

const AuditCodexAgent = new SmithersCodexAgent({
  ...CodexAgent.opts,
  config: {
    ...baseCodexConfig,
    web_search: "disabled",
  },
  yolo: false,
  sandbox: "read-only",
  disable: CodexAgent.opts.disable,
});

const ciaImpact = z.object({
  confidentiality: z.object({
    level: impactLevel,
    affectedAssets: stringList,
    risk: z.string(),
    evidence: z.string(),
  }),
  integrity: z.object({
    level: impactLevel,
    affectedAssets: stringList,
    risk: z.string(),
    evidence: z.string(),
  }),
  availability: z.object({
    level: impactLevel,
    affectedAssets: stringList,
    risk: z.string(),
    evidence: z.string(),
  }),
});

const asset = z.object({
  name: z.string(),
  category: z.enum([
    "user-data",
    "credential",
    "identity",
    "database",
    "storage",
    "source-code",
    "build-artifact",
    "runtime",
    "admin-surface",
    "financial",
    "ai-context",
    "integration",
    "other",
  ]),
  sensitivity: impactLevel,
  exposure: z.enum(["public", "authenticated", "internal", "privileged", "unknown"]),
  ownerOrBoundary: z.string(),
  dataHandled: stringList,
  relatedComponents: stringList,
  entryPoints: stringList,
  ciaCriticality: z.object({
    confidentiality: impactLevel,
    integrity: impactLevel,
    availability: impactLevel,
  }),
  worstCaseImpact: z.string(),
  evidence: z.string(),
});

const architectureComponent = z.object({
  name: z.string(),
  kind: z.enum([
    "frontend",
    "api",
    "backend-service",
    "database",
    "storage",
    "queue",
    "worker",
    "auth-provider",
    "ci-cd",
    "deployment",
    "third-party",
    "ai-system",
    "other",
  ]),
  role: z.string(),
  technology: z.string(),
  trustZone: z.string(),
  assetsHandled: stringList,
  ingress: stringList,
  egress: stringList,
  authBoundary: z.string(),
  failureModes: stringList,
  evidence: z.string(),
});

const integration = z.object({
  name: z.string(),
  type: z.string(),
  evidence: z.string(),
  dataShared: stringList,
  privileges: stringList,
  inboundFlows: stringList,
  outboundFlows: stringList,
  keyRisks: stringList,
  localEvidenceAvailable: z.boolean(),
  needsExternalInspection: z.boolean(),
  externalInspectionNotes: z.string(),
});

const dangerousPath = z.object({
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  attackerStartingPoint: z.string(),
  path: stringList,
  affectedAssets: stringList,
  ciaImpact: ciaAxisList,
  whyDangerous: z.string(),
  evidence: z.string(),
  controlsToVerify: stringList,
});

const riskLead = z.object({
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  ciaImpact: ciaAxisList,
  evidence: z.string(),
  impact: z.string(),
  validationNeeded: z.string(),
  mappedFrameworks: stringList,
});

const finding = z.object({
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  confidence: z.enum(["proven", "likely", "possible", "scanner-lead"]),
  ciaImpact: ciaAxisList,
  affectedAssets: stringList,
  exploitScenario: z.string(),
  preconditions: z.string(),
  evidence: z.string(),
  impact: z.string(),
  rootCause: z.string(),
  frameworkMapping: stringList,
  recommendedFix: z.string(),
  verificationSteps: stringList,
  residualRisk: z.string(),
});

const threatModelScoping = z.object({
  priorityAttackVectors: stringList,
  focusAreas: stringList,
  repositoryContext: z.string(),
  auditPriorities: stringList,
  requiredEvidence: stringList,
  outOfScope: stringList,
  assumptions: stringList,
  commitHistoryRequested: z.boolean(),
  commitHistorySince: z.string(),
  validationConcurrency: z.number(),
});

const commandRecord = z.object({
  command: z.string(),
  purpose: z.string(),
  status: z.enum(["ran", "skipped", "missing-tool", "failed", "not-applicable"]),
  summary: z.string(),
  artifactPath: z.string(),
});

const commitHistoryIntake = z.object({
  requested: z.boolean(),
  since: z.string(),
  repoPath: z.string(),
  isGitRepository: z.boolean(),
  commandsRun: commandRecord.array(),
  commitsReviewed: z.array(
    z.object({
      hash: z.string(),
      date: z.string(),
      subject: z.string(),
      filesChanged: stringList,
    }),
  ),
  changedFiles: stringList,
  changedSecuritySurfaces: z.array(
    z.object({
      surface: z.string(),
      files: stringList,
      reason: z.string(),
      priority: z.enum(["p0", "p1", "p2", "p3"]),
      recommendedAuditFocus: stringList,
    }),
  ),
  assumptions: stringList,
  limitations: stringList,
});

const validationDisposition = z.enum(["keep", "downgrade", "reject", "needs-human-confirmation"]);
const validationStatus = z.enum(["reproduced", "partially-reproduced", "not-reproduced", "blocked", "not-safe-to-validate"]);

const findingValidationJob = z.object({
  findingId: z.string().regex(/^validate-finding-\d{3}-/, {
    message: "findingId must be the exact validation node id, not a progress/status placeholder",
  }),
  findingTitle: z.string().min(10),
  originalSeverity: z.enum(["critical", "high", "medium", "low", "info"]),
  validationStatus,
  recommendedDisposition: validationDisposition,
  confidenceAfterValidation: z.enum(["proven", "likely", "possible", "scanner-lead"]),
  ciaImpactConfirmed: ciaAxisList,
  affectedAssetsConfirmed: nonEmptyStringList,
  commandsRun: commandRecord.array().min(1),
  evidenceChecked: nonEmptyStringList,
  exactEvidence: z.array(
    z.string().regex(/(?:^|[\s`(])[\w./()[\]-]+:\d+(?:-\d+)?/, {
      message: "exactEvidence entries must contain file:line or file:start-end evidence",
    }),
  ).min(1),
  exploitabilityAssessment: z.string().min(40),
  ciaAssessment: z.string().min(40),
  falsePositiveNotes: z.string().min(10),
  environmentOrAccessBlockers: stringList,
  safetyNotes: z.string().min(20),
});

const findingValidationSummary = z.object({
  totalManualFindings: z.number(),
  totalValidationJobs: z.number(),
  jobs: findingValidationJob.array(),
  keptFindings: stringList,
  downgradedOrRejectedFindings: stringList,
  needsHumanConfirmation: stringList,
  coverageMetrics: z.object({
    reproducedOrPartial: z.number(),
    notReproduced: z.number(),
    blockedOrUnsafe: z.number(),
    jobsWithLineEvidence: z.number(),
  }),
  limitations: stringList,
});

const phaseEvaluation = z.object({
  phase: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  score: z.number(),
  checks: stringList,
  issues: stringList,
  replayRecommendation: z.string(),
});

const qualityGateSchema = z.object({
  overallStatus: z.enum(["pass", "warn", "fail"]),
  overallScore: z.number(),
  phaseEvaluations: phaseEvaluation.array(),
  strongestSignals: stringList,
  improvementNotes: stringList,
  replayRecommendations: stringList,
});

type Finding = z.infer<typeof finding>;
type Asset = z.infer<typeof asset>;
type Integration = z.infer<typeof integration>;
type DangerousPath = z.infer<typeof dangerousPath>;
type CiaImpact = z.infer<typeof ciaImpact>;
type FindingValidationJob = z.infer<typeof findingValidationJob>;
type FindingValidationSummary = z.infer<typeof findingValidationSummary>;
type AnnotatedFinding = Finding & {
  validationStatus?: "not-validated" | z.infer<typeof validationStatus>;
  validationSummary?: string;
};
type QualityGate = z.infer<typeof qualityGateSchema>;

const { Workflow, Task, outputs, smithers } = createSmithers({
  input: z.object({
    repoPath: z.string().default("."),
    auditMode: z.enum(["quick", "standard", "deep"]).default("standard"),
    targetUrl: z.string().optional(),
    allowActiveScanning: z.boolean().default(false),
    allowOutOfWorkspacePaths: z.boolean().default(false),
    appProfile: z.string().optional(),
    outputDir: z.string().default(".smithers/audit-reports"),
    priorityAttackVectors: stringList.default([]),
    focusAreas: stringList.default([]),
    repositoryContext: z.string().default(""),
    scanCommitHistorySince: z.string().default(""),
    validationConcurrency: z.number().int().min(1).max(4).default(2),
  }),
  scopePolicy: z.object({
    workspaceRoot: z.string(),
    repoPathInput: z.string(),
    outputDirInput: z.string(),
    repoPath: z.string(),
    outputDir: z.string(),
    repoPathInsideWorkspace: z.boolean(),
    outputDirInsideWorkspace: z.boolean(),
    activeScanningAllowed: z.boolean(),
    targetUrl: z.string(),
    targetHost: z.string(),
    policySummary: z.string(),
    guardrails: stringList,
    warnings: stringList,
  }),
  threatModelScoping,
  commitHistoryIntake,
  auditIntake: z.object({
    repoPath: z.string(),
    auditMode: z.enum(["quick", "standard", "deep"]),
    targetUrl: z.string(),
    activeScanningAllowed: z.boolean(),
    projectSummary: z.string(),
    technologyStack: stringList,
    packageManagers: stringList,
    entryPoints: stringList,
    exposedSurfaces: stringList,
    dataStores: stringList,
    authModel: z.string(),
    deploymentModel: z.string(),
    ciCdSurfaces: stringList,
    sensitiveAssets: stringList,
    aiUsageSignals: stringList,
    securityDocsFound: stringList,
    assumptions: stringList,
    unknowns: stringList,
    recommendedManualFocus: stringList,
  }),
  assetArchitectureMap: z.object({
    architectureSummary: z
      .string()
      .min(40, "architectureSummary must describe the inspected system")
      .regex(/^(?!.*\b(i will|i.ll|pending|placeholder|todo)\b).+$/i, {
        message: "architectureSummary must be the completed map, not a plan or placeholder",
      }),
    assets: asset.array().min(3, "assetArchitectureMap must include multiple concrete assets"),
    components: architectureComponent.array().min(2, "assetArchitectureMap must include multiple concrete components"),
    integrations: integration.array(),
    dataFlows: z.array(
      z.object({
        name: z.string(),
        source: z.string(),
        destination: z.string(),
        data: stringList,
        trustBoundary: z.string(),
        authentication: z.string(),
        authorization: z.string(),
        confidentialityRisk: z.string(),
        integrityRisk: z.string(),
        availabilityRisk: z.string(),
        evidence: z.string(),
      }),
    ).min(2, "assetArchitectureMap must include multiple concrete data flows"),
    ciaOverview: ciaImpact.refine(
      (overview) =>
        overview.confidentiality.level !== "none" ||
        overview.integrity.level !== "none" ||
        overview.availability.level !== "none",
      { message: "assetArchitectureMap CIA overview must classify at least one axis above none" },
    ),
    mostDangerousPaths: dangerousPath.array().min(2, "assetArchitectureMap must include multiple concrete dangerous paths"),
    externalInspectionPlan: z.array(
      z.object({
        system: z.string(),
        reason: z.string(),
        whatToInspect: stringList,
        localEvidence: z.string(),
        connectorOrAccessNeeded: z.string(),
        priority: z.enum(["p0", "p1", "p2", "p3"]),
      }),
    ),
    assumptions: stringList,
    unknowns: stringList,
  }),
  assetMapQuality: phaseEvaluation,
  threatModel: z.object({
    architectureSummary: z.string(),
    components: z.array(
      z.object({
        name: z.string(),
        role: z.string(),
        trustLevel: z.string(),
        sensitiveDataHandled: stringList,
      }),
    ),
    trustBoundaries: z.array(
      z.object({
        name: z.string(),
        crossing: z.string(),
        attackerControl: z.string(),
        controlsToVerify: stringList,
      }),
    ),
    criticalFlows: z.array(
      z.object({
        name: z.string(),
        actors: stringList,
        assets: stringList,
        entryPoints: stringList,
        trustBoundaries: stringList,
        ciaImpact: ciaAxisList.min(1),
        abuseCases: stringList,
        controlsToVerify: stringList,
        riskHypothesis: z.string(),
      }),
    ),
    topArchitectureRisks: riskLead.array(),
    scannerPlan: z.array(
      z.object({
        category: z.string(),
        purpose: z.string(),
        suggestedCommands: stringList,
        activeScan: z.boolean(),
        runOnlyIf: z.string(),
      }),
    ),
    manualReviewPlan: stringList,
  }),
  automatedEvidence: z.object({
    scanLimits: stringList,
    commandsRun: z.array(
      z.object({
        command: z.string(),
        purpose: z.string(),
        status: z.enum(["ran", "skipped", "missing-tool", "failed", "not-applicable"]),
        summary: z.string(),
        artifactPath: z.string(),
      }),
    ),
    toolsMissing: stringList,
    artifactsCreated: stringList,
    scannerLeads: riskLead.array(),
    supplyChainObservations: stringList,
    ciCdObservations: stringList,
    activeScanObservations: stringList,
  }),
  manualReview: z.object({
    reviewPasses: z.array(
      z.object({
        area: z.string(),
        filesReviewed: stringList,
        observations: stringList,
        potentialFindings: riskLead.array(),
      }),
    ),
    validatedFindings: finding.array(),
    falsePositivesOrWeakLeads: stringList,
    needsHumanConfirmation: stringList,
    skippedAreas: stringList,
  }),
  findingValidationJob,
  findingValidationSummary,
  auditReport: z.object({
    executiveSummary: z.string(),
    scope: z.string(),
    reportPath: z.string(),
    artifactDirectory: z.string(),
    assetInventory: asset.array(),
    integrationInventory: integration.array(),
    ciaImpactSummary: ciaImpact,
    mostDangerousPaths: dangerousPath.array(),
    externalInspectionPlan: z.array(
      z.object({
        system: z.string(),
        reason: z.string(),
        whatToInspect: stringList,
        localEvidence: z.string(),
        connectorOrAccessNeeded: z.string(),
        priority: z.enum(["p0", "p1", "p2", "p3"]),
      }),
    ),
    architectureMap: z.string(),
    threatModelSummary: z.string(),
    cyberImpactNarrative: z.string(),
    reportMarkdown: z.string(),
    findings: finding.array(),
    prioritizedBacklog: z.array(
      z.object({
        priority: z.enum(["p0", "p1", "p2", "p3"]),
        workItem: z.string(),
        rootCauseAddressed: z.string(),
        expectedRiskReduction: z.string(),
      }),
    ),
    reAuditPlan: stringList,
    scannerCoverage: stringList,
    limitations: stringList,
  }),
  reportFile: z.object({
    reportPath: z.string(),
    artifactDirectory: z.string(),
    bytes: z.number(),
    status: z.enum(["written"]),
  }),
  qualityGate: qualityGateSchema,
});

const methodBrief = `
Audit method to apply:
- Start with architecture and threat modeling, not scanner output.
- Build an explicit asset inventory before assigning severity: identify data, identities, credentials, databases, storage, admin surfaces, CI/CD authority, runtime systems, source-to-production paths, and third-party integrations.
- Classify every meaningful risk by the CIA triad: confidentiality, integrity, and availability. Severity must explain which assets are harmed and how.
- Identify the most dangerous paths through the system: cross-tenant data access, privilege escalation, production compromise, secret leakage, data deletion/corruption, and availability or cost abuse.
- Treat scanners as evidence generators. A scanner alert is not a finding until cyber impact is explained.
- Map issues to NIST SSDF, OWASP SAMM, OWASP ASVS, OWASP WSTG, OWASP Top 10 2025, OWASP API Top 10, OWASP CI/CD Top 10, CISA Secure by Design, Microsoft SDL, SLSA, and OpenSSF Scorecard where relevant.
- Review code, architecture, CI/CD, dependencies, secrets, deployment, runtime controls, logging, incident response, and AI-specific risks.
	- For integrations such as Supabase, Firebase, Clerk, Stripe, GitHub, Vercel, cloud providers, email, analytics, and LLM platforms, inspect local code/config evidence and record what external project settings would need direct inspection later. Do not assume external access exists.
	- For AI-generated code, treat security-sensitive code as untrusted until independently reviewed.
	- For LLM/RAG/agentic features, review prompt injection, data leakage, tool permissions, RAG ACLs, output handling, excessive agency, and unbounded consumption.
	- Use local repository evidence only during audit execution. Do not browse the web or do external research from inside the audit workflow.
	- Agent phases are read-only. Do not edit files, create files, redirect command output to files, run formatters, run autofix commands, install packages, update lockfiles, or otherwise mutate the audited repository.
	- The only allowed write in the entire workflow is the deterministic final audit report written to scopePolicy.outputDir/audit-report.md.
	- Never include concrete secret, token, password, key, cookie, or credential values in structured output. Redact values as [REDACTED] while preserving variable names, file paths, and line numbers.
	- Do not perform credential attacks, destructive fuzzing, exploit chaining, persistence, data exfiltration, or high-volume scans.
	- Active network scanning is allowed only when allowActiveScanning is true and a targetUrl is provided.
	`;

const auditDepthGuidance = (mode: "quick" | "standard" | "deep") => {
  if (mode === "quick") {
    return `
Audit depth for this run: quick.
- Keep each phase bounded and evidence-driven.
- Prioritize the top externally reachable trust boundaries, secrets, authz/authn, webhooks, file handling, CI/CD, and storage/database controls.
- Prefer top 5-8 highest-impact assets, top 3-5 dangerous paths, and top 5-8 findings unless a critical pattern requires one more item.
- Do not re-read broad UI/component trees unless they touch auth, data, third-party script execution, or deployment/security configuration.
`;
  }

  if (mode === "deep") {
    return `
Audit depth for this run: deep.
- Broaden coverage beyond the highest-risk paths after core trust boundaries are reviewed.
- Include secondary business logic, operational resilience, dependency governance, logging/monitoring, incident response, and AI/future-feature risks.
- Preserve more scanner leads and human-confirmation items when evidence is incomplete but the potential blast radius is high.
`;
  }

  return `
Audit depth for this run: standard.
- Cover all major trust boundaries and high-impact assets without attempting exhaustive line-by-line review of every file.
- Favor concrete findings with direct evidence over speculative breadth.
	`;
};

const qualityMinimums = (mode: "quick" | "standard" | "deep") => {
  if (mode === "deep") {
    return {
      assets: 6,
      components: 4,
      dataFlows: 3,
      dangerousPaths: 3,
      entryPoints: 2,
      criticalFlows: 4,
      architectureRisks: 3,
      scannerPlan: 3,
      manualReviewPlan: 3,
      evidenceCommands: 8,
      backlogItems: 4,
    };
  }

  if (mode === "quick") {
    return {
      assets: 3,
      components: 2,
      dataFlows: 2,
      dangerousPaths: 2,
      entryPoints: 1,
      criticalFlows: 2,
      architectureRisks: 1,
      scannerPlan: 2,
      manualReviewPlan: 2,
      evidenceCommands: 5,
      backlogItems: 2,
    };
  }

  return {
    assets: 4,
    components: 3,
    dataFlows: 2,
    dangerousPaths: 2,
    entryPoints: 1,
    criticalFlows: 3,
    architectureRisks: 2,
    scannerPlan: 2,
    manualReviewPlan: 2,
    evidenceCommands: 6,
    backlogItems: 3,
  };
};

const recordsAbsence = (text: string) => /\b(no|none|not found|not detected|absent|unknown|static|library|docs-only)\b/i.test(text);

const format = (value: unknown) => JSON.stringify(value, null, 2);

const resolvePath = (workspaceRoot: string, value: string) =>
  isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value);

const isInside = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const realpathForMaybeMissing = (candidate: string) => {
  let ancestor = candidate;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      return candidate;
    }
    ancestor = parent;
  }

  return resolve(realpathSync(ancestor), relative(ancestor, candidate));
};

const uniqueList = (items: string[]) =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const boundedList = (items: string[], max: number) => uniqueList(items).slice(0, max);

const validationConcurrency = (value: number) => Math.min(4, Math.max(1, Number.isFinite(value) ? value : 2));

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "finding";

const findingValidationId = (entry: Pick<Finding, "title">, index: number) =>
  `validate-finding-${String(index + 1).padStart(3, "0")}-${slugify(entry.title)}`;

const command = (parts: string[]) => parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");

const runGit = (repoPath: string, args: string[], purpose: string) => {
  const gitCommand = command(["git", "-C", repoPath, ...args]);
  try {
    const output = execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 6,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      record: {
        command: gitCommand,
        purpose,
        status: "ran" as const,
        summary: output.trim().slice(0, 4000) || "Command completed with no output.",
        artifactPath: "",
      },
      output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      record: {
        command: gitCommand,
        purpose,
        status: "failed" as const,
        summary: message.slice(0, 4000),
        artifactPath: "",
      },
      output: "",
    };
  }
};

const parseGitLogNameOnly = (output: string) => {
  const commits: Array<{ hash: string; date: string; subject: string; filesChanged: string[] }> = [];
  let current: { hash: string; date: string; subject: string; filesChanged: string[] } | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const header = line.split("\t");
    if (/^[0-9a-f]{7,40}$/i.test(header[0] || "") && header.length >= 3) {
      if (current) {
        commits.push({ ...current, filesChanged: boundedList(current.filesChanged, 60) });
      }
      current = { hash: header[0], date: header[1], subject: header.slice(2).join("\t"), filesChanged: [] };
      continue;
    }

    current?.filesChanged.push(line);
  }

  if (current) {
    commits.push({ ...current, filesChanged: boundedList(current.filesChanged, 60) });
  }

  return commits;
};

const classifyChangedSecuritySurfaces = (files: string[]) => {
  const surfaceRules: Array<{
    surface: string;
    pattern: RegExp;
    reason: string;
    priority: "p0" | "p1" | "p2" | "p3";
    recommendedAuditFocus: string[];
  }> = [
    {
      surface: "authentication and session handling",
      pattern: /(auth|session|login|logout|oauth|oidc|stack|clerk|nextauth|middleware)/i,
      reason: "Recent changes touch identity, session, or request-gating code.",
      priority: "p0",
      recommendedAuditFocus: ["auth bypass", "session validation", "redirect and callback integrity"],
    },
    {
      surface: "authorization and tenant isolation",
      pattern: /(permission|policy|role|owner|tenant|organization|workspace|admin|access)/i,
      reason: "Recent changes touch authorization, ownership, tenant, or admin semantics.",
      priority: "p0",
      recommendedAuditFocus: ["IDOR", "cross-tenant access", "privilege escalation"],
    },
    {
      surface: "database schema and migrations",
      pattern: /(schema|migration|prisma|drizzle|sql|database|db)/i,
      reason: "Recent changes touch persistent data shape or migration behavior.",
      priority: "p1",
      recommendedAuditFocus: ["data integrity", "RLS or app-side authorization", "destructive migration risk"],
    },
    {
      surface: "file storage and upload/download flows",
      pattern: /(upload|download|file|storage|bucket|s3|minio|blob|presigned|avatar|media)/i,
      reason: "Recent changes touch object storage, file metadata, or transfer paths.",
      priority: "p1",
      recommendedAuditFocus: ["object ownership", "file type validation", "storage ACLs", "cost abuse"],
    },
    {
      surface: "webhooks and third-party integrations",
      pattern: /(webhook|stripe|lemon|billing|payment|github|vercel|supabase|firebase|resend|email)/i,
      reason: "Recent changes touch inbound or outbound integration boundaries.",
      priority: "p1",
      recommendedAuditFocus: ["signature verification", "idempotency", "least privilege", "secret handling"],
    },
    {
      surface: "CI/CD, deployment, and supply chain",
      pattern: /(\.github|workflow|action|docker|vercel|netlify|deploy|build|package\.json|pnpm-lock|bun\.lock|yarn\.lock|package-lock)/i,
      reason: "Recent changes touch source-to-production or dependency surfaces.",
      priority: "p2",
      recommendedAuditFocus: ["secret exposure", "untrusted build inputs", "dependency risk", "deployment authority"],
    },
    {
      surface: "AI, LLM, and agent/tool boundaries",
      pattern: /(ai|llm|openai|anthropic|prompt|rag|embedding|vector|agent|tool)/i,
      reason: "Recent changes touch AI context, prompts, tools, or model integrations.",
      priority: "p2",
      recommendedAuditFocus: ["prompt injection", "data leakage", "tool permission boundaries", "cost abuse"],
    },
    {
      surface: "runtime availability and background jobs",
      pattern: /(cron|queue|worker|job|rate|limit|cache|redis|timeout|retry)/i,
      reason: "Recent changes touch background execution, resource controls, or availability-sensitive code.",
      priority: "p2",
      recommendedAuditFocus: ["denial of service", "retry storms", "job authorization", "resource exhaustion"],
    },
  ];

  return surfaceRules
    .map((rule) => ({ ...rule, files: boundedList(files.filter((file) => rule.pattern.test(file)), 20) }))
    .filter((rule) => rule.files.length > 0)
    .map(({ surface, files: matchedFiles, reason, priority, recommendedAuditFocus }) => ({
      surface,
      files: matchedFiles,
      reason,
      priority,
      recommendedAuditFocus,
    }));
};

const bulletList = (items: string[]) =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None recorded";

const containsUnredactedSecretValue = (text: string) =>
  /(?:[?&]|\b)(?:access_token|refresh_token|id_token|token|api[_-]?key|secret|password|signature|sig)=(?!\[(?:REDACTED|REDACTED_SECRET)\])[^&\s`'")]+/i.test(
    text,
  ) ||
  /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL)[A-Z0-9_]*=(?![\s`'")\].,;]|$|\[REDACTED\])[^`\s'")\],;]+/.test(
    text,
  ) ||
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s@]+:[^@\s]+@/i.test(text) ||
  /\bBearer\s+(?!<secret>|<token>|\$\{|\[REDACTED\])([A-Za-z0-9._~+/=-]{8,})/i.test(text);

const redactSensitiveText = (text: string) =>
  text
    .replace(
      /((?:[?&]|\b)(?:access_token|refresh_token|id_token|token|api[_-]?key|secret|password|signature|sig)=)(?!\[(?:REDACTED|REDACTED_SECRET)\])[^&\s`'")]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL)[A-Z0-9_]*=)(?![\s`'")\].,;]|$|\[REDACTED\])[^`\s'")\],;]+/g,
      "$1[REDACTED]",
    )
    .replace(
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s@]+:)[^@\s]+@/gi,
      "$1[REDACTED]@",
    )
    .replace(
      /\b(Bearer\s+)(?!<secret>|<token>|\$\{|\[REDACTED\])([A-Za-z0-9._~+/=-]{8,})/gi,
      "$1[REDACTED]",
    );

const formatCia = (cia: CiaImpact) =>
  [
    `- Confidentiality: ${cia.confidentiality.level}. ${cia.confidentiality.risk} Evidence: ${cia.confidentiality.evidence}`,
    `- Integrity: ${cia.integrity.level}. ${cia.integrity.risk} Evidence: ${cia.integrity.evidence}`,
    `- Availability: ${cia.availability.level}. ${cia.availability.risk} Evidence: ${cia.availability.evidence}`,
  ].join("\n");

const renderAsset = (entry: Asset) =>
  `- ${entry.name} (${entry.category}, ${entry.sensitivity}, ${entry.exposure}): ${entry.worstCaseImpact} Evidence: ${entry.evidence}`;

const renderIntegration = (entry: Integration) =>
  `- ${entry.name} (${entry.type}): ${entry.keyRisks.join("; ") || "No key risks recorded"}. Evidence: ${entry.evidence}. External inspection: ${entry.externalInspectionNotes}`;

const renderDangerousPath = (entry: DangerousPath) =>
  [
    `### ${entry.severity.toUpperCase()}: ${entry.title}`,
    `CIA: ${entry.ciaImpact.join(", ")}`,
    `Starting point: ${entry.attackerStartingPoint}`,
    `Path: ${entry.path.join(" -> ")}`,
    `Affected assets: ${entry.affectedAssets.join(", ")}`,
    `Why dangerous: ${entry.whyDangerous}`,
    `Evidence: ${entry.evidence}`,
    `Controls to verify:\n${bulletList(entry.controlsToVerify)}`,
  ].join("\n\n");

const renderFinding = (entry: AnnotatedFinding) =>
  [
    `### ${entry.severity.toUpperCase()}: ${entry.title}`,
    `Confidence: ${entry.confidence}`,
    ...(entry.validationStatus
      ? [
          `Validation: ${entry.validationStatus}${entry.validationSummary ? `. ${entry.validationSummary}` : ""}`,
        ]
      : []),
    `CIA: ${entry.ciaImpact.join(", ")}`,
    `Affected assets: ${entry.affectedAssets.join(", ")}`,
    `Evidence: ${entry.evidence}`,
    `Exploit scenario: ${entry.exploitScenario}`,
    `Preconditions: ${entry.preconditions}`,
    `Impact: ${entry.impact}`,
    `Root cause: ${entry.rootCause}`,
    `Recommended fix: ${entry.recommendedFix}`,
    `Verification steps:\n${bulletList(entry.verificationSteps)}`,
    `Residual risk: ${entry.residualRisk}`,
    `Framework mapping: ${entry.frameworkMapping.join(", ")}`,
  ].join("\n\n");

const renderValidationJob = (entry: FindingValidationJob) =>
  [
    `### ${entry.findingTitle}`,
    `Status: ${entry.validationStatus}`,
    `Disposition: ${entry.recommendedDisposition}`,
    `Confidence after validation: ${entry.confidenceAfterValidation}`,
    `CIA confirmed: ${entry.ciaImpactConfirmed.join(", ")}`,
    `Assets confirmed: ${entry.affectedAssetsConfirmed.join(", ")}`,
    `Evidence checked:\n${bulletList(entry.evidenceChecked)}`,
    `Exact evidence:\n${bulletList(entry.exactEvidence)}`,
    `Exploitability: ${entry.exploitabilityAssessment}`,
    `CIA assessment: ${entry.ciaAssessment}`,
    `False-positive notes: ${entry.falsePositiveNotes}`,
    `Blockers:\n${bulletList(entry.environmentOrAccessBlockers)}`,
    `Safety notes: ${entry.safetyNotes}`,
  ].join("\n\n");

const renderValidationSummary = (summary: FindingValidationSummary) =>
  [
    `${summary.totalValidationJobs}/${summary.totalManualFindings} manual findings received validation jobs.`,
    `Reproduced or partial: ${summary.coverageMetrics.reproducedOrPartial}. Not reproduced: ${summary.coverageMetrics.notReproduced}. Blocked or unsafe: ${summary.coverageMetrics.blockedOrUnsafe}. Jobs with line evidence: ${summary.coverageMetrics.jobsWithLineEvidence}.`,
    "Kept findings:",
    bulletList(summary.keptFindings),
    "Downgraded or rejected findings:",
    bulletList(summary.downgradedOrRejectedFindings),
    "Needs human confirmation:",
    bulletList(summary.needsHumanConfirmation),
    "Validation limitations:",
    bulletList(summary.limitations),
    "Validation jobs:",
    summary.jobs.map(renderValidationJob).join("\n\n") || "- None recorded",
  ].join("\n\n");

const hasLineEvidence = (text: string) => /(?:^|[\s`(])[\w./()[\]-]+:\d+(?:-\d+)?/.test(text);

const downgradedSeverity = (severity: Finding["severity"]): Finding["severity"] => {
  const nextSeverity: Record<Finding["severity"], Finding["severity"]> = {
    critical: "high",
    high: "medium",
    medium: "low",
    low: "info",
    info: "info",
  };
  return nextSeverity[severity];
};

const findingCategory = (entry: Pick<Finding, "title" | "evidence">) => {
  const text = `${entry.title} ${entry.evidence}`.toLowerCase();
  if (/\b(auth|authorization|access control|idor|bola|tenant|owner|permission|privilege)\b/i.test(text)) {
    return "access-control";
  }
  if (/\b(webhook|signature|hmac|replay|event id|idempotency)\b/i.test(text)) {
    return "webhook-integrity";
  }
  if (/\b(secret|token|password|credential|cookie|session|log|telemetry)\b/i.test(text)) {
    return "secret-handling";
  }
  if (/\b(upload|download|file|storage|bucket|object|presigned|attachment)\b/i.test(text)) {
    return "file-storage";
  }
  if (/\b(cron|job|worker|scheduler|admin|reconcile|background)\b/i.test(text)) {
    return "admin-job-auth";
  }
  if (/\b(migration|deploy|ci|cd|build|release|pipeline|artifact)\b/i.test(text)) {
    return "source-to-production";
  }
  if (/\b(dependency|package|lockfile|supply-chain|slsa|openssl|npm|pnpm|yarn|bun)\b/i.test(text)) {
    return "supply-chain";
  }
  if (/\b(sql injection|injection|command injection|xss|csrf|ssrf|deserialization)\b/i.test(text)) {
    return "injection-or-request-forgery";
  }
  if (/\b(ai|llm|prompt|rag|embedding|agent|tool call|model)\b/i.test(text)) {
    return "ai-boundary";
  }
  return entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
};

const mergeValidatedFindings = (manualFindings: Finding[], _reportFindings: Finding[]) => {
  return manualFindings;
};

const validationByTitle = (summary?: FindingValidationSummary) => {
  const byTitle = new Map<string, FindingValidationJob>();
  for (const job of summary?.jobs ?? []) {
    byTitle.set(slugify(job.findingTitle), job);
  }
  return byTitle;
};

const applyValidationToFindings = (findings: Finding[], summary?: FindingValidationSummary): AnnotatedFinding[] => {
  const byTitle = validationByTitle(summary);
  const applied: AnnotatedFinding[] = [];

  for (const entry of findings) {
    const job = byTitle.get(slugify(entry.title));
    if (!job) {
      applied.push({
        ...entry,
        validationStatus: "not-validated",
        validationSummary: "No validation job matched this finding.",
      });
      continue;
    }

    if (job.recommendedDisposition === "reject") {
      continue;
    }

    applied.push({
      ...entry,
      severity: job.recommendedDisposition === "downgrade" ? downgradedSeverity(entry.severity) : entry.severity,
      confidence: job.confidenceAfterValidation,
      ciaImpact: job.ciaImpactConfirmed,
      affectedAssets: job.affectedAssetsConfirmed.length > 0 ? job.affectedAssetsConfirmed : entry.affectedAssets,
      validationStatus: job.validationStatus,
      validationSummary: `${job.recommendedDisposition}. ${job.exploitabilityAssessment}`,
    });
  }

  return applied;
};

type PhaseCheck = {
  label: string;
  pass: boolean;
  issue: string;
};

const evaluatePhase = (phase: string, checks: PhaseCheck[], replayRecommendation: string) => {
  const passed = checks.filter((check) => check.pass).length;
  const score = checks.length === 0 ? 0 : Math.round((passed / checks.length) * 100);
  const status = score >= 85 ? ("pass" as const) : score >= 60 ? ("warn" as const) : ("fail" as const);

  return {
    phase,
    status,
    score,
    checks: checks.map((check) => `${check.pass ? "PASS" : "FAIL"}: ${check.label}`),
    issues: checks.filter((check) => !check.pass).map((check) => check.issue),
    replayRecommendation: status === "pass" ? "No replay needed." : replayRecommendation,
  };
};

const renderQualityGate = (quality: QualityGate) =>
  [
    `Overall: ${quality.overallStatus.toUpperCase()} (${quality.overallScore}/100)`,
    "Phase evaluations:",
    quality.phaseEvaluations
      .map(
        (phase) =>
          `- ${phase.phase}: ${phase.status.toUpperCase()} (${phase.score}/100). ${phase.issues.length > 0 ? phase.issues.join("; ") : "No blocking issues."}`,
      )
      .join("\n") || "- None recorded",
    "Strongest signals:",
    bulletList(quality.strongestSignals),
    "Improvement notes:",
    bulletList(quality.improvementNotes),
    "Replay recommendations:",
    bulletList(quality.replayRecommendations),
  ].join("\n\n");

const renderMarkdownReport = (report: {
  executiveSummary: string;
  scope: string;
  assetInventory: Asset[];
  integrationInventory: Integration[];
  ciaImpactSummary: CiaImpact;
  mostDangerousPaths: DangerousPath[];
  externalInspectionPlan: Array<{
    system: string;
    reason: string;
    whatToInspect: string[];
    localEvidence: string;
    connectorOrAccessNeeded: string;
    priority: "p0" | "p1" | "p2" | "p3";
  }>;
  architectureMap: string;
  threatModelSummary: string;
  cyberImpactNarrative: string;
  findings: AnnotatedFinding[];
  prioritizedBacklog: Array<{
    priority: "p0" | "p1" | "p2" | "p3";
    workItem: string;
    rootCauseAddressed: string;
    expectedRiskReduction: string;
  }>;
  reAuditPlan: string[];
  scannerCoverage: string[];
  limitations: string[];
}, quality?: QualityGate, validation?: FindingValidationSummary) =>
  redactSensitiveText([
    "# Cyber Security Audit Report",
    "## Executive Summary",
    report.executiveSummary,
    "## Scope",
    report.scope,
    "## Architecture Inventory",
    report.architectureMap,
    "## Asset Inventory",
    report.assetInventory.map(renderAsset).join("\n") || "- None recorded",
    "## Integration Inventory",
    report.integrationInventory.map(renderIntegration).join("\n") || "- None recorded",
    "## CIA Impact Summary",
    formatCia(report.ciaImpactSummary),
    "## Most Dangerous Paths",
    report.mostDangerousPaths.map(renderDangerousPath).join("\n\n") || "- None recorded",
    ...(validation ? ["## Finding Validation", renderValidationSummary(validation)] : []),
    "## Findings",
    report.findings.map(renderFinding).join("\n\n") || "- No validated findings recorded",
    "## Prioritized Backlog",
    report.prioritizedBacklog
      .map(
        (item) =>
          `- ${item.priority}: ${item.workItem}. Root cause: ${item.rootCauseAddressed}. Risk reduction: ${item.expectedRiskReduction}`,
      )
      .join("\n") || "- None recorded",
    "## External Inspection Plan",
    report.externalInspectionPlan
      .map(
        (item) =>
          `- ${item.priority}: ${item.system}. ${item.reason} Inspect: ${item.whatToInspect.join("; ")}. Local evidence: ${item.localEvidence}. Access needed: ${item.connectorOrAccessNeeded}`,
      )
      .join("\n") || "- None recorded",
    "## Threat Model Summary",
    report.threatModelSummary,
    "## Cyber Impact Narrative",
    report.cyberImpactNarrative,
    "## Scanner Coverage",
    bulletList(report.scannerCoverage),
    "## Limitations",
    bulletList(report.limitations),
    ...(quality ? ["## Workflow Quality Gate", renderQualityGate(quality)] : []),
    "## Re-audit Plan",
    bulletList(report.reAuditPlan),
  ].join("\n\n"));

export default smithers((ctx) => {
  const scopePolicy = ctx.outputMaybe(outputs.scopePolicy, { nodeId: "scope-policy" });
  const scoping = ctx.outputMaybe(outputs.threatModelScoping, { nodeId: "threat-model-scoping" });
  const commitHistory = ctx.outputMaybe(outputs.commitHistoryIntake, { nodeId: "commit-history-intake" });
  const intake = ctx.outputMaybe(outputs.auditIntake, { nodeId: "audit-intake" });
  const assetArchitectureMap = ctx.outputMaybe(outputs.assetArchitectureMap, {
    nodeId: "asset-architecture-map",
  });
  const assetMapQuality = ctx.outputMaybe(outputs.assetMapQuality, {
    nodeId: "asset-map-quality",
  });
  const threatModel = ctx.outputMaybe(outputs.threatModel, { nodeId: "threat-model" });
  const evidence = ctx.outputMaybe(outputs.automatedEvidence, { nodeId: "automated-evidence" });
  const manualReview = ctx.outputMaybe(outputs.manualReview, { nodeId: "manual-review" });
  const validationJobs =
    manualReview?.validatedFindings.map((entry, index) => ({
      id: findingValidationId(entry, index),
      index,
      finding: entry,
      result: ctx.outputMaybe(outputs.findingValidationJob, { nodeId: findingValidationId(entry, index) }),
    })) ?? [];
  const validationJobsComplete =
    validationJobs.length === 0 || validationJobs.every((job) => job.result !== undefined);
  const validationSummary = ctx.outputMaybe(outputs.findingValidationSummary, {
    nodeId: "finding-validation-summary",
  });
  const auditReport = ctx.outputMaybe(outputs.auditReport, { nodeId: "audit-report" });
  const qualityGate = ctx.outputMaybe(outputs.qualityGate, { nodeId: "quality-gate" });
  const commitHistoryReady = !ctx.input.scanCommitHistorySince || commitHistory !== undefined;

  return (
    <Workflow name="cyber-security-audit">
	      <Task id="scope-policy" output={outputs.scopePolicy} noRetry>
	        {() => {
	          const workspaceRoot = realpathSync(process.cwd());
	          const repoPathInput = ctx.input.repoPath || ".";
	          const outputDirInput = ctx.input.outputDir || ".smithers/audit-reports";
	          const allowOutOfWorkspacePaths = ctx.input.allowOutOfWorkspacePaths === true;
	          const repoPathCandidate = resolvePath(workspaceRoot, repoPathInput);
	          if (!existsSync(repoPathCandidate)) {
	            throw new Error(`Repository path does not exist: ${repoPathCandidate}`);
	          }
	          const repoPath = realpathSync(repoPathCandidate);
	          const outputDirCandidate = resolvePath(workspaceRoot, outputDirInput);
	          const outputDirPlannedReal = realpathForMaybeMissing(outputDirCandidate);
	          const repoPathInsideWorkspace = isInside(workspaceRoot, repoPath);
	          const outputDirInsideWorkspace = isInside(workspaceRoot, outputDirPlannedReal);
	          const warnings: string[] = [];

	          if (!repoPathInsideWorkspace) {
	            warnings.push(`repoPath resolves outside workspaceRoot: ${repoPath}`);
	          }
	          if (!outputDirInsideWorkspace) {
	            warnings.push(`outputDir resolves outside workspaceRoot: ${outputDirPlannedReal}`);
	          }
	          if ((!repoPathInsideWorkspace || !outputDirInsideWorkspace) && !allowOutOfWorkspacePaths) {
	            throw new Error(
	              "Unsafe audit scope: repoPath and outputDir must resolve inside the workflow workspace unless allowOutOfWorkspacePaths is true.",
	            );
	          }

	          mkdirSync(outputDirCandidate, { recursive: true });
	          const outputDirReal = realpathSync(outputDirCandidate);
	          const outputDirInsideWorkspaceFinal = isInside(workspaceRoot, outputDirReal);
	          if (!outputDirInsideWorkspaceFinal && !allowOutOfWorkspacePaths) {
	            throw new Error(`Refusing to use outputDir outside workspaceRoot: ${outputDirReal}`);
	          }

          const targetUrl = ctx.input.targetUrl || "";
          let targetHost = "";
          let targetUrlValid = false;
          if (targetUrl) {
            try {
              const parsedUrl = new URL(targetUrl);
              targetUrlValid = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
              targetHost = parsedUrl.host;
              if (!targetUrlValid) {
                warnings.push(`targetUrl must use http or https for active scanning: ${targetUrl}`);
              }
            } catch {
              warnings.push(`targetUrl is not a valid URL: ${targetUrl}`);
            }
          }

          const activeScanningAllowed =
            ctx.input.allowActiveScanning === true && targetUrl !== "" && targetUrlValid;
          if (ctx.input.allowActiveScanning === true && !activeScanningAllowed) {
            warnings.push("Active scanning was requested but disabled because targetUrl is empty or invalid.");
          }

          return {
            workspaceRoot,
            repoPathInput,
            outputDirInput,
	            repoPath,
	            outputDir: outputDirReal,
	            repoPathInsideWorkspace,
	            outputDirInsideWorkspace: outputDirInsideWorkspaceFinal,
            activeScanningAllowed,
            targetUrl,
            targetHost,
            policySummary: activeScanningAllowed
              ? `Repo-local audit with active scanning authorized for ${targetHost}.`
              : "Repo-local audit only. Active network scanning is disabled.",
	            guardrails: [
	              "Use scopePolicy.repoPath as the only repository root.",
	              "Agent phases are read-only and must return structured output only.",
	              "The only allowed write is the deterministic final audit report at scopePolicy.outputDir/audit-report.md.",
	              "Do not read or write outside workspaceRoot unless allowOutOfWorkspacePaths was true at preflight.",
	              "Do not run active network scanning unless scopePolicy.activeScanningAllowed is true.",
	              "Do not browse the web or perform external research from inside the audit workflow.",
	              "Redact concrete secret values in all outputs; preserve names and line references, not raw values.",
	            ],
            warnings,
          };
        }}
      </Task>

      {scopePolicy ? (
        <Task id="threat-model-scoping" output={outputs.threatModelScoping} noRetry>
          {() => {
            const priorityAttackVectors = boundedList(ctx.input.priorityAttackVectors ?? [], 20);
            const focusAreas = boundedList(ctx.input.focusAreas ?? [], 20);
            const repositoryContext = (ctx.input.repositoryContext ?? "").trim();
            const defaultPriorities = [
              "authn/authz bypass and IDOR",
              "tenant or ownership boundary breaks",
              "secret, credential, token, and session leakage",
              "webhook and third-party integration integrity",
              "file upload/download and object storage abuse",
              "CI/CD and source-to-production compromise",
              "availability, cost, and background-job abuse",
            ];
            const auditPriorities = boundedList(
              [...priorityAttackVectors, ...focusAreas, ...(ctx.input.appProfile ? [ctx.input.appProfile] : []), ...defaultPriorities],
              30,
            );
            const outOfScope = [
              "Patch proposal generation, remediation branches, and code editing in the audited repository.",
              "Post-fix revalidation loops.",
              "Cross-run finding feedback memory.",
              "Live external-system inspection through provider dashboards or MCP connectors.",
              ...(scopePolicy.activeScanningAllowed
                ? []
                : ["Active network scanning and live target probing are out of scope for this run."]),
            ];

            return {
              priorityAttackVectors,
              focusAreas,
              repositoryContext,
              auditPriorities,
              requiredEvidence: [
                "exact local file and line evidence for validated findings",
                "asset and CIA impact mapping for each meaningful risk",
                "architecture and trust-boundary evidence before severity assignment",
                "scanner output treated as a lead until manually validated",
                "commit-history context when scanCommitHistorySince is provided",
              ],
              outOfScope,
              assumptions: [
                "The workflow is defensive and read-only against the audited repository.",
                "External provider settings are inferred from local code/config unless explicitly connected in a later workflow version.",
                repositoryContext || "No additional repository context was supplied by the operator.",
              ],
              commitHistoryRequested: Boolean(ctx.input.scanCommitHistorySince),
              commitHistorySince: ctx.input.scanCommitHistorySince ?? "",
              validationConcurrency: validationConcurrency(ctx.input.validationConcurrency ?? 2),
            };
          }}
        </Task>
      ) : null}

      {scopePolicy && scoping && ctx.input.scanCommitHistorySince ? (
        <Task id="commit-history-intake" output={outputs.commitHistoryIntake} noRetry>
          {() => {
            const since = ctx.input.scanCommitHistorySince ?? "";
            const commandsRun: Array<z.infer<typeof commandRecord>> = [];
            const revParse = runGit(
              scopePolicy.repoPath,
              ["rev-parse", "--is-inside-work-tree"],
              "Verify that commit-history scanning is running inside a git repository.",
            );
            commandsRun.push(revParse.record);
            const isGitRepository = revParse.record.status === "ran" && revParse.output.trim() === "true";

            if (!isGitRepository) {
              return {
                requested: true,
                since,
                repoPath: scopePolicy.repoPath,
                isGitRepository,
                commandsRun,
                commitsReviewed: [],
                changedFiles: [],
                changedSecuritySurfaces: [],
                assumptions: [],
                limitations: ["Commit-history scanning was requested, but the audited path is not a git repository."],
              };
            }

            const log = runGit(
              scopePolicy.repoPath,
              ["log", "--since", since, "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%s", "--name-only", "--max-count=80"],
              "Review recent commits and changed files inside the requested scan window.",
            );
            commandsRun.push(log.record);

            const commitsReviewed = parseGitLogNameOnly(log.output).slice(0, 80);
            const changedFiles = boundedList(
              commitsReviewed.flatMap((commit) => commit.filesChanged),
              250,
            );

            if (commitsReviewed.length > 0) {
              const hashes = commitsReviewed.slice(0, 12).map((commit) => commit.hash);
              const showStats = runGit(
                scopePolicy.repoPath,
                ["show", "--stat", "--oneline", "--find-renames", "--find-copies", ...hashes],
                "Inspect bounded commit stats for recently changed security-relevant surfaces.",
              );
              commandsRun.push(showStats.record);

              const riskyFiles = classifyChangedSecuritySurfaces(changedFiles)
                .flatMap((surface) => surface.files)
                .slice(0, 6);
              if (riskyFiles.length > 0) {
                const patchHistory = runGit(
                  scopePolicy.repoPath,
                  ["log", "--since", since, "--patch", "--max-count=5", "--", ...riskyFiles],
                  "Inspect bounded patch history for the highest-risk recently changed files.",
                );
                commandsRun.push({
                  ...patchHistory.record,
                  summary:
                    patchHistory.record.status === "ran"
                      ? `Inspected patch history for ${riskyFiles.length} high-risk changed files. Raw diff omitted from structured output.`
                      : patchHistory.record.summary,
                });
              }
            }

            return {
              requested: true,
              since,
              repoPath: scopePolicy.repoPath,
              isGitRepository,
              commandsRun,
              commitsReviewed,
              changedFiles,
              changedSecuritySurfaces: classifyChangedSecuritySurfaces(changedFiles),
              assumptions: [
                "Commit-history intake is used for audit prioritization, not as a replacement for full architecture review.",
              ],
              limitations:
                commitsReviewed.length > 0
                  ? ["Only bounded commit metadata and selected patch history were inspected to keep the workflow reliable."]
                  : [`No commits were found since ${since}.`],
            };
          }}
        </Task>
      ) : null}

      {scopePolicy && scoping && commitHistoryReady ? (
        <Task id="audit-intake" output={outputs.auditIntake} agent={AuditCodexAgent} noRetry>
          {`
You are doing the intake phase for a defensive cyber security audit workflow.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy from the preflight compute step:
${format(scopePolicy)}

Threat-model scoping from the operator:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Work to perform:
1. Inspect the repository at scopePolicy.repoPath without modifying it.
2. Identify languages, frameworks, package managers, lockfiles, build systems, CI/CD files, container/IaC files, deployment clues, auth providers, data stores, exposed routes, API specs, admin surfaces, and AI/LLM/agent usage signals.
3. Read existing security docs, architecture docs, README files, CI files, package manifests, and obvious entry points.
4. Reflect the scoping priorities and any recent commit-history security surfaces in recommendedManualFocus.
5. Produce a concise intake object. Use scopePolicy.repoPath as repoPath, scopePolicy.targetUrl as targetUrl, and scopePolicy.activeScanningAllowed as activeScanningAllowed. Use empty strings or arrays for unknowns; do not invent facts.

Operational guidance:
- Prefer rg, rg --files, git, sed, package manifests, config files, and route definitions.
- Keep intake shallow. Do not perform deep manual code review in this phase; defer detailed line-by-line review to manual-review.
- Sample representative files and small snippets instead of dumping whole source trees. If a file is large, read targeted sections only.
- Do not install tools or run active scans in this phase.
- Do not create artifacts or write files in this phase. Return structured output only.
`}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake ? (
        <Task
          id="asset-architecture-map"
          output={outputs.assetArchitectureMap}
          agent={AuditCodexAgent}
          retries={1}
        >
          {`
You are building the asset, architecture, integration, CIA, and dangerous-path map for a defensive cyber security audit.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Audit intake:
${format(intake)}

Work to perform:
1. Inspect local repository evidence only. Use README/docs, package manifests, env examples, DB schemas/migrations, route definitions, auth middleware, storage code, CI/CD files, deployment config, webhook handlers, and integration SDK usage.
2. Produce a concrete asset inventory. Include data, identities, credentials, sessions/tokens, databases, storage buckets, admin surfaces, CI/CD authority, source code, build artifacts, runtime systems, AI context, and third-party integration assets when present.
3. Produce an architecture inventory. Name frontend, API/backend, database, auth provider, storage, queues/workers, jobs, deployment/runtime, CI/CD, and third-party systems. Capture evidence for each component; do not invent missing systems.
4. Map important data flows and trust boundaries. For each flow, explain authentication, authorization, and confidentiality/integrity/availability risk.
5. Build a CIA overview for the whole system. Be explicit about what could leak, what could be modified or forged, and what could be degraded or destroyed.
6. Rank the most dangerous paths through the system. Focus on cross-user or cross-tenant data access, privilege escalation, production compromise, secret leakage, data deletion/corruption, payment or webhook abuse, AI tool abuse, and availability/cost abuse.
7. Build an externalInspectionPlan for systems that cannot be fully audited from local repo evidence. Example: if Supabase is detected, record that later direct inspection should check RLS policies, auth settings, storage bucket ACLs, Edge Functions, exposed RPCs, service role key handling, and database roles. Do not attempt live connector/MCP inspection in this workflow version.

Output expectations:
- Every asset and component needs evidence.
	- Return the completed architecture map, not a plan for how you will inspect it.
	- Do not emit any JSON or structured object until the repository inspection is complete; intermediate progress messages that match the output schema can be captured as final output.
	- Do not return placeholder values such as "placeholder", "pending", empty inventories, or zero CIA impact after saying you will inspect.
	- Scale coverage to the repository. Small libraries, static sites, and clean repos should be mapped honestly instead of padded with invented integrations or assets.
	- For larger standard and deep application audits, use the intake evidence to produce enough coverage for downstream threat modeling: aim for 4-8 assets, 3-5 components, integrations when present, 2-4 data flows, and 2-3 dangerous paths.
	- Mark uncertainty in unknowns instead of guessing.
	- Use empty arrays where a category is not present.
	`}
        </Task>
      ) : null}

	      {scopePolicy && scoping && intake && assetArchitectureMap ? (
	        <Task id="asset-map-quality" output={outputs.assetMapQuality} noRetry>
	          {() => {
	            const minimums = qualityMinimums(ctx.input.auditMode ?? "standard");
	            const architectureContext = [
	              assetArchitectureMap.architectureSummary,
	              ...assetArchitectureMap.assumptions,
	              ...assetArchitectureMap.unknowns,
	            ].join(" ");
	            const nonNoneCia =
	              assetArchitectureMap.ciaOverview.confidentiality.level !== "none" ||
	              assetArchitectureMap.ciaOverview.integrity.level !== "none" ||
              assetArchitectureMap.ciaOverview.availability.level !== "none";
            const completedSummary = !/\b(i will|i.ll|pending|placeholder|todo)\b/i.test(
              assetArchitectureMap.architectureSummary,
            );
            const noPlaceholderEntries = [
              ...assetArchitectureMap.assets.map((entry) => `${entry.name} ${entry.evidence}`),
              ...assetArchitectureMap.components.map((entry) => `${entry.name} ${entry.evidence}`),
              ...assetArchitectureMap.dataFlows.map((entry) => `${entry.name} ${entry.evidence}`),
              ...assetArchitectureMap.mostDangerousPaths.map((entry) => `${entry.title} ${entry.evidence}`),
            ].every((value) => !/\bplaceholder\b/i.test(value));

            const evaluation = evaluatePhase(
              "asset-architecture-map",
              [
	                {
	                  label: "Asset inventory is broad enough for severity assignment",
	                  pass: assetArchitectureMap.assets.length >= minimums.assets,
	                  issue: `Asset inventory has fewer than ${minimums.assets} assets for ${ctx.input.auditMode} mode.`,
	                },
	                {
	                  label: "Architecture components identified",
	                  pass: assetArchitectureMap.components.length >= minimums.components,
	                  issue: `Architecture component inventory has fewer than ${minimums.components} components for ${ctx.input.auditMode} mode.`,
	                },
	                {
	                  label: "Integrations identified or absence recorded",
	                  pass: assetArchitectureMap.integrations.length > 0 || recordsAbsence(architectureContext),
	                  issue: "Integration inventory is empty without an explicit absence/unknown note.",
	                },
	                {
	                  label: "Data flows and trust boundaries mapped",
	                  pass: assetArchitectureMap.dataFlows.length >= minimums.dataFlows,
	                  issue: `Data-flow mapping has fewer than ${minimums.dataFlows} flows for ${ctx.input.auditMode} mode.`,
	                },
                {
                  label: "CIA overview has non-empty risk classification",
                  pass: nonNoneCia,
                  issue: "CIA overview did not classify any axis above none.",
                },
	                {
	                  label: "Most dangerous paths identified",
	                  pass: assetArchitectureMap.mostDangerousPaths.length >= minimums.dangerousPaths,
	                  issue: `Fewer than ${minimums.dangerousPaths} dangerous paths were identified for ${ctx.input.auditMode} mode.`,
	                },
	                {
	                  label: "External inspection plan produced when needed",
	                  pass: assetArchitectureMap.externalInspectionPlan.length > 0 || recordsAbsence(architectureContext),
	                  issue: "External inspection plan is missing without an explicit no-external-systems note.",
	                },
                {
                  label: "Output is completed evidence, not a plan or placeholder",
                  pass: completedSummary && noPlaceholderEntries,
                  issue: "Asset map appears to contain planning or placeholder output.",
                },
              ],
              "Retry asset-architecture-map; do not proceed with threat modeling until assets, flows, and CIA map are complete.",
            );

            if (evaluation.status === "fail") {
              throw new Error(`Asset architecture map failed quality gate: ${evaluation.issues.join("; ")}`);
            }

            return evaluation;
          }}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake && assetArchitectureMap && assetMapQuality ? (
        <Task id="threat-model" output={outputs.threatModel} agent={AuditCodexAgent} noRetry>
          {`
You are doing the architecture and threat-modeling phase for a defensive cyber security audit.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Audit intake:
${format(intake)}

Asset and architecture map:
${format(assetArchitectureMap)}

Work to perform:
1. Build a concise threat model from the intake, the asset/architecture map, and any additional repo inspection needed.
2. Identify components, trust boundaries, sensitive data, user roles, service identities, privileged flows, tenant boundaries, integrations, and source-to-production paths.
3. Create critical flows for the highest-impact areas: authentication, authorization, tenant isolation, admin actions, payment or data-export flows, file handling, webhooks, background jobs, CI/CD publishing, deployment, and AI tool usage if present.
4. For each critical flow, produce realistic abuse cases, controls to verify, affected assets, and CIA impact.
5. Produce a scanner plan that is safe by default. Active network commands must be marked activeScan=true and run only if scopePolicy.activeScanningAllowed is true.

Do not reduce this to a generic checklist. Tie risks to this repository's actual architecture and evidence.
Avoid broad line-by-line code review in this phase; only inspect code to clarify architecture or produce flow evidence. Manual-review is responsible for detailed line-level validation.
`}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake && assetArchitectureMap && threatModel ? (
        <Task
          id="automated-evidence"
          output={outputs.automatedEvidence}
          agent={AuditCodexAgent}
          timeoutMs={1000 * 60 * 30}
          heartbeatTimeoutMs={1000 * 60 * 20}
          retries={1}
        >
          {`
You are collecting automated evidence for a defensive cyber security audit.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Audit intake:
${format(intake)}

Asset and architecture map:
${format(assetArchitectureMap)}

Threat model:
${format(threatModel)}

Work to perform:
1. Collect evidence in read-only mode. Do not create files, redirect command output, install tools, update lockfiles, run autofix, or modify the audited repository.
2. Detect which security tools are installed. Check for CodeQL, Semgrep, Gitleaks, TruffleHog, OSV-Scanner, Trivy, Syft, Grype, Checkov, Nuclei, ZAP baseline tooling, and testssl.sh.
3. Run only read-only repo-local evidence commands that fit the detected technology stack, assets, integrations, and dangerous paths. Examples: git status, file inventory, read-only grep/sed inspections, and read-only CI posture checks.
4. If a tool is missing, record it. Do not install new scanners unless the user explicitly provided that as part of the repo setup.
5. Do not run package-manager audit commands when the matching lockfile is missing. Record them as not-applicable instead.
6. Avoid commands known to write logs, caches, or audit artifacts in this environment unless a project lockfile exists and the command is expected to run read-only.
7. Do not run registry/network-dependent package audit commands when the runtime has no network access or the registry is unreachable. Record them as not-applicable or failed without retrying.
8. Keep this phase bounded: run at most 25 evidence commands, prefer combined rg/nl/file-inventory commands, and do not re-read long files already covered by the asset map or threat model unless needed for scanner-lead evidence.
9. If scopePolicy.activeScanningAllowed is false, do not run ZAP, Nuclei against a live target, testssl.sh against a live target, or any other active network scan. Record the skipped commands.
10. If active scanning is authorized, scan only scopePolicy.targetUrl and keep it conservative: baseline/passive checks, safe templates, no brute force, no destructive checks, no exploit chains, no invasive fuzzing.
11. Summarize useful raw outputs in the structured response. Leave artifactPath empty for commands that did not write an artifact.

Important:
- Scanner leads are not proven findings. Capture what needs manual validation.
- Preserve CIA context for scanner leads: identify whether the lead could affect confidentiality, integrity, availability, or multiple axes.
- If a command fails because dependencies are not installed, record the failure and continue.
- Do not modify application source code.
- Set artifactsCreated to an empty array unless you are reporting pre-existing artifacts observed in the repository.
`}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake && assetArchitectureMap && threatModel && evidence ? (
        <Task
          id="manual-review"
          output={outputs.manualReview}
          agent={AuditCodexAgent}
          timeoutMs={1000 * 60 * 45}
          noRetry
        >
          {`
You are doing the manual review phase for a defensive cyber security audit.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Audit intake:
${format(intake)}

Asset and architecture map:
${format(assetArchitectureMap)}

Threat model:
${format(threatModel)}

Automated evidence:
${format(evidence)}

Work to perform:
1. Review the highest-impact code paths from the asset inventory, dangerous paths, threat model, and scanner leads.
2. Prioritize authn, authz, tenant isolation, admin actions, sensitive data flows, input-to-sink paths, file upload/download, webhooks, secrets, crypto, CI/CD, supply chain, and AI-specific surfaces.
3. For AI-generated or likely AI-generated code, independently verify all security-sensitive logic and dependencies.
4. Validate or reject scanner leads. Record false positives and weak leads separately.
5. Produce findings only when you can provide concrete evidence and a realistic cyber impact scenario.
6. Every finding must name affected assets and classify the CIA impact.

Review expectations:
- Cite file paths and function/route names in evidence.
- Cite exact line references in evidence using file:line or file:start-end format whenever the file is local. Do not use approximate references such as "line ~36" or "around line 36"; run nl -ba or equivalent targeted reads to get exact lines.
- Explain exploit preconditions.
- Explain blast radius and affected assets.
- Explain confidentiality, integrity, and/or availability impact.
- Prefer root-cause fixes over one-line patches.
- If evidence is insufficient, put the item in needsHumanConfirmation instead of overstating it.
`}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake && assetArchitectureMap && threatModel && evidence && manualReview ? (
        <MergeQueue id="finding-validation-jobs" maxConcurrency={scoping.validationConcurrency}>
          {validationJobs.map((job) => (
            <Task
              key={job.id}
              id={job.id}
              output={outputs.findingValidationJob}
              agent={AuditCodexAgent}
              timeoutMs={1000 * 60 * 25}
              noRetry
            >
              {`
You are validating one candidate finding from a defensive cyber security audit.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Audit intake:
${format(intake)}

Asset and architecture map:
${format(assetArchitectureMap)}

Threat model:
${format(threatModel)}

Automated evidence:
${format(evidence)}

Finding to validate:
${format(job.finding)}

Required output identifiers:
- findingId: ${job.id}
- findingTitle: ${job.finding.title}

Work to perform:
1. Re-check the finding against local repository evidence only. Use targeted rg, sed, nl -ba, git, and package/config reads.
2. Try to falsify the finding before confirming it. Look for upstream authorization, middleware, schema constraints, provider validation, or runtime controls that could invalidate the issue.
3. Confirm or correct the CIA impact and affected assets.
4. Record read-only commands in commandsRun. Do not create files, redirect output to files, install packages, run fixers, run migrations, or edit code.
5. Do not run live target probes, exploit chains, credential attacks, destructive fuzzing, or data exfiltration. If validation would require those, mark validationStatus as not-safe-to-validate or blocked.
6. Preserve exact local line evidence using file:line or file:start-end in exactEvidence whenever repository files are cited.
7. recommendedDisposition must be keep, downgrade, reject, or needs-human-confirmation. Reject only when local evidence clearly disproves the finding.
`}
            </Task>
          ))}
        </MergeQueue>
      ) : null}

      {scopePolicy && scoping && manualReview && validationJobsComplete ? (
        <Task id="finding-validation-summary" output={outputs.findingValidationSummary} noRetry>
          {() => {
            const jobs = validationJobs
              .map((job) => job.result)
              .filter((job): job is FindingValidationJob => job !== undefined);
            const jobsWithLineEvidence = jobs.filter((job) =>
              job.exactEvidence.some((line) => hasLineEvidence(line)),
            ).length;

            return {
              totalManualFindings: manualReview.validatedFindings.length,
              totalValidationJobs: jobs.length,
              jobs,
              keptFindings: jobs
                .filter((job) => job.recommendedDisposition === "keep")
                .map((job) => job.findingTitle),
              downgradedOrRejectedFindings: jobs
                .filter((job) => job.recommendedDisposition === "downgrade" || job.recommendedDisposition === "reject")
                .map((job) => `${job.recommendedDisposition}: ${job.findingTitle}`),
              needsHumanConfirmation: jobs
                .filter((job) => job.recommendedDisposition === "needs-human-confirmation")
                .map((job) => job.findingTitle),
              coverageMetrics: {
                reproducedOrPartial: jobs.filter(
                  (job) => job.validationStatus === "reproduced" || job.validationStatus === "partially-reproduced",
                ).length,
                notReproduced: jobs.filter((job) => job.validationStatus === "not-reproduced").length,
                blockedOrUnsafe: jobs.filter(
                  (job) => job.validationStatus === "blocked" || job.validationStatus === "not-safe-to-validate",
                ).length,
                jobsWithLineEvidence,
              },
              limitations:
                jobs.length === manualReview.validatedFindings.length
                  ? []
                  : [
                      `Validation job count (${jobs.length}) did not match manual finding count (${manualReview.validatedFindings.length}).`,
                    ],
            };
          }}
        </Task>
      ) : null}

      {scopePolicy && scoping && intake && assetArchitectureMap && threatModel && evidence && manualReview && validationSummary ? (
        <Task id="audit-report" output={outputs.auditReport} agent={AuditCodexAgent} noRetry>
          {`
You are producing the final cyber security audit report.

${methodBrief}
${auditDepthGuidance(ctx.input.auditMode)}

Scope policy:
${format(scopePolicy)}

Threat-model scoping:
${format(scoping)}

Commit-history intake:
${commitHistory ? format(commitHistory) : "Commit-history scanning was not requested for this run."}

Workflow input:
${format(ctx.input)}

Audit intake:
${format(intake)}

Asset and architecture map:
${format(assetArchitectureMap)}

Threat model:
${format(threatModel)}

Automated evidence:
${format(evidence)}

Manual review:
${format(manualReview)}

Finding validation summary:
${format(validationSummary)}

Work to perform:
1. Produce a concise but complete report object.
2. Include the asset inventory, integration inventory, CIA summary, and most dangerous paths from the asset/architecture map. Condense only when needed; do not drop high-impact assets.
3. The findings array must contain only findings that came from manualReview.validatedFindings and their validation jobs. Do not introduce new primary findings in audit-report.
4. Put unvalidated governance concerns, missing external evidence, scanner leads, and architecture assumptions in externalInspectionPlan, limitations, scannerCoverage, prioritizedBacklog, or reAuditPlan instead of findings.
5. Separate reproduced/partially reproduced findings from likely/possible issues, rejected findings, and scanner leads.
6. Merge duplicate findings and keep severity tied to realistic CIA impact on named assets. Do not promote findings that validation rejected.
7. Include a prioritized remediation backlog that addresses root causes and repeatability.
8. Include limitations, external inspection needs, and a re-audit plan.
9. Preserve exact evidence from Manual review, especially file paths and line numbers. Do not replace line-specific evidence with generic path-only summaries.
10. Do not write files. Populate reportMarkdown with the complete human-readable markdown report.
11. Set reportPath to scopePolicy.outputDir/audit-report.md as the intended deterministic write path. Set artifactDirectory to scopePolicy.outputDir.

The reportMarkdown value should be useful to builders and security reviewers. Include sections for Scope, Architecture Inventory, Asset Inventory, CIA Impact Summary, Most Dangerous Paths, Findings, Prioritized Backlog, External Inspection Plan, Scanner Coverage, Limitations, and Re-audit Plan.
`}
        </Task>
      ) : null}

	      {scopePolicy && scoping && intake && assetArchitectureMap && threatModel && evidence && manualReview && validationSummary && auditReport ? (
	        <Task id="quality-gate" output={outputs.qualityGate} noRetry>
	          {() => {
	            const minimums = qualityMinimums(ctx.input.auditMode ?? "standard");
	            const mergedFindings = applyValidationToFindings(
	              mergeValidatedFindings(manualReview.validatedFindings, auditReport.findings),
	              validationSummary,
	            );
            const manualFindingCategories = new Set(manualReview.validatedFindings.map(findingCategory));
            const reportFindingCategories = new Set(auditReport.findings.map(findingCategory));
            const reportOnlyFindings = auditReport.findings.filter(
              (entry) => !manualFindingCategories.has(findingCategory(entry)),
            );
            const reportPreview = renderMarkdownReport(
              { ...auditReport, findings: mergedFindings },
              undefined,
              validationSummary,
            );
            const manualLineEvidenceCount = manualReview.validatedFindings.filter((entry) =>
              hasLineEvidence(entry.evidence),
            ).length;
            const mergedLineEvidenceCount = mergedFindings.filter((entry) =>
              hasLineEvidence(entry.evidence),
            ).length;
            const validationLineEvidenceCount = validationSummary.jobs.filter((job) =>
              job.exactEvidence.some((line) => hasLineEvidence(line)),
            ).length;
            const rejectedValidationCount = validationSummary.jobs.filter(
              (job) => job.recommendedDisposition === "reject",
            ).length;
            const activeScanSkipped =
              !scopePolicy.activeScanningAllowed &&
              evidence.commandsRun.some(
                (command) =>
                  command.status === "skipped" &&
                  /nuclei|zap|testssl/i.test(command.command + command.summary),
              );
	            const nonNoneCia =
	              assetArchitectureMap.ciaOverview.confidentiality.level !== "none" ||
	              assetArchitectureMap.ciaOverview.integrity.level !== "none" ||
	              assetArchitectureMap.ciaOverview.availability.level !== "none";
	            const architectureContext = [
	              assetArchitectureMap.architectureSummary,
	              ...assetArchitectureMap.assumptions,
	              ...assetArchitectureMap.unknowns,
	              intake.projectSummary,
	              intake.authModel,
	              intake.deploymentModel,
	              ...intake.unknowns,
	            ].join(" ");
	            const scannerAvailabilityRecorded =
	              evidence.toolsMissing.length > 0 ||
	              evidence.commandsRun.some((entry) => /which|command -v|tool|scanner|availability/i.test(`${entry.command} ${entry.purpose} ${entry.summary}`));

	            const phaseEvaluations = [
              evaluatePhase(
                "scope-policy",
                [
                  {
                    label: "Repository path exists and was resolved before agent execution",
                    pass: existsSync(scopePolicy.repoPath),
                    issue: `Repository path does not exist: ${scopePolicy.repoPath}`,
                  },
                  {
                    label: "Output directory remains inside workflow workspace",
                    pass: scopePolicy.outputDirInsideWorkspace,
                    issue: "Output directory is outside the workflow workspace.",
                  },
                  {
                    label: "Agent guardrails explicitly require read-only structured output",
                    pass: scopePolicy.guardrails.some((guardrail) => /read-only/i.test(guardrail)),
                    issue: "Scope policy did not include an explicit read-only guardrail.",
                  },
                  {
                    label: "Active scanning is disabled unless explicitly authorized with a valid target",
                    pass: !ctx.input.allowActiveScanning || scopePolicy.activeScanningAllowed,
                    issue: "Active scanning was requested but the scope policy could not authorize it.",
                  },
                ],
                "Fix input scope and rerun from scope-policy.",
              ),
              evaluatePhase(
                "threat-model-scoping",
                [
                  {
                    label: "Operator scoping normalized into audit priorities",
                    pass: scoping.auditPriorities.length >= 5,
                    issue: "Threat-model scoping produced too few audit priorities.",
                  },
                  {
                    label: "Out-of-scope boundaries are explicit",
                    pass: scoping.outOfScope.length >= 3,
                    issue: "Threat-model scoping did not capture enough out-of-scope boundaries.",
                  },
                  {
                    label: "Evidence expectations are explicit",
                    pass: scoping.requiredEvidence.length >= 4,
                    issue: "Threat-model scoping did not capture evidence expectations.",
                  },
                ],
                "Retry threat-model-scoping to normalize operator priorities and out-of-scope boundaries.",
              ),
              ...(ctx.input.scanCommitHistorySince && commitHistory
                ? [
                    evaluatePhase(
                      "commit-history-intake",
                      [
                        {
                          label: "Commit-history request was handled",
                          pass: commitHistory.requested && commitHistory.commandsRun.length >= 1,
                          issue: "Commit-history intake did not record the requested scan attempt.",
                        },
                        {
                          label: "Git repository inspected or limitation recorded",
                          pass:
                            commitHistory.isGitRepository ||
                            commitHistory.limitations.some((item) => /not a git repository/i.test(item)),
                          issue: "Commit-history intake did not inspect git state or record a non-git limitation.",
                        },
                        {
                          label: "Commit-history commands were recorded when git metadata exists",
                          pass: !commitHistory.isGitRepository || commitHistory.commandsRun.length >= 2,
                          issue: "Commit-history intake recorded too few git commands.",
                        },
                        {
                          label: "Changed files or explicit no-commit limitation recorded",
                          pass:
                            !commitHistory.isGitRepository ||
                            commitHistory.changedFiles.length > 0 ||
                            commitHistory.limitations.length > 0,
                          issue: "Commit-history intake did not record changed files or a no-commit limitation.",
                        },
                        {
                          label: "Changed security surfaces classified when changed files exist",
                          pass: commitHistory.changedFiles.length === 0 || commitHistory.changedSecuritySurfaces.length > 0,
                          issue: "Commit-history intake did not classify changed security surfaces.",
                        },
                      ],
                      "Retry commit-history-intake with bounded git log/show inspection.",
                    ),
                  ]
                : []),
              evaluatePhase(
                "audit-intake",
                [
	                  {
	                    label: "Technology stack identified",
	                    pass: intake.technologyStack.length >= 1 || recordsAbsence(architectureContext),
	                    issue: "Technology stack inventory is empty without an explicit absence/unknown note.",
	                  },
	                  {
	                    label: "Entry points identified",
	                    pass: intake.entryPoints.length >= minimums.entryPoints || recordsAbsence(architectureContext),
	                    issue: `Entry point inventory has fewer than ${minimums.entryPoints} entries without an explicit absence/unknown note.`,
	                  },
	                  {
	                    label: "Data stores identified or absence recorded",
	                    pass: intake.dataStores.length > 0 || recordsAbsence(architectureContext),
	                    issue: "No data stores were identified and no explicit absence/unknown note was recorded.",
	                  },
                  {
                    label: "Auth and deployment models summarized",
                    pass: intake.authModel.trim().length > 0 && intake.deploymentModel.trim().length > 0,
                    issue: "Auth or deployment model summary is missing.",
                  },
                  {
                    label: "Manual focus list generated",
                    pass: intake.recommendedManualFocus.length >= 3,
                    issue: "Manual-review focus list is too thin.",
                  },
                ],
                "Retry audit-intake with stronger repository inventory instructions.",
              ),
              evaluatePhase(
                "asset-architecture-map",
                [
	                  {
	                    label: "Asset inventory is broad enough for severity assignment",
	                    pass: assetArchitectureMap.assets.length >= minimums.assets,
	                    issue: `Asset inventory has fewer than ${minimums.assets} assets for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Architecture components identified",
	                    pass: assetArchitectureMap.components.length >= minimums.components,
	                    issue: `Architecture component inventory has fewer than ${minimums.components} components for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Integrations identified or absence recorded",
	                    pass: assetArchitectureMap.integrations.length > 0 || recordsAbsence(architectureContext),
	                    issue: "Integration inventory is empty without an explicit absence/unknown note.",
	                  },
	                  {
	                    label: "Data flows and trust boundaries mapped",
	                    pass: assetArchitectureMap.dataFlows.length >= minimums.dataFlows,
	                    issue: `Data-flow mapping has fewer than ${minimums.dataFlows} flows for ${ctx.input.auditMode} mode.`,
	                  },
                  {
                    label: "CIA overview has non-empty risk classification",
                    pass: nonNoneCia,
                    issue: "CIA overview did not classify any axis above none.",
                  },
	                  {
	                    label: "Most dangerous paths identified",
	                    pass: assetArchitectureMap.mostDangerousPaths.length >= minimums.dangerousPaths,
	                    issue: `Fewer than ${minimums.dangerousPaths} dangerous paths were identified for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "External inspection plan produced when needed",
	                    pass: assetArchitectureMap.externalInspectionPlan.length > 0 || recordsAbsence(architectureContext),
	                    issue: "External inspection plan is missing without an explicit no-external-systems note.",
	                  },
                ],
                "Retry asset-architecture-map; do not proceed with threat modeling until assets, flows, and CIA map are complete.",
              ),
              evaluatePhase(
                "threat-model",
                [
	                  {
	                    label: "Trust boundaries identified",
	                    pass: threatModel.trustBoundaries.length >= Math.min(3, minimums.criticalFlows),
	                    issue: "Threat model has too few trust boundaries for the selected audit mode.",
	                  },
	                  {
	                    label: "Critical flows identified",
	                    pass: threatModel.criticalFlows.length >= minimums.criticalFlows,
	                    issue: `Threat model has fewer than ${minimums.criticalFlows} critical flows for ${ctx.input.auditMode} mode.`,
	                  },
                  {
                    label: "Every critical flow has CIA impact",
                    pass: threatModel.criticalFlows.every((flow) => flow.ciaImpact.length > 0),
                    issue: "At least one critical flow lacks CIA impact.",
                  },
	                  {
	                    label: "Architecture risks generated",
	                    pass: threatModel.topArchitectureRisks.length >= minimums.architectureRisks,
	                    issue: `Threat model has fewer than ${minimums.architectureRisks} top architecture risks for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Scanner plan generated",
	                    pass: threatModel.scannerPlan.length >= minimums.scannerPlan,
	                    issue: `Scanner plan has fewer than ${minimums.scannerPlan} entries for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Manual-review plan generated",
	                    pass: threatModel.manualReviewPlan.length >= minimums.manualReviewPlan,
	                    issue: `Manual-review plan has fewer than ${minimums.manualReviewPlan} entries for ${ctx.input.auditMode} mode.`,
	                  },
                ],
                "Retry threat-model using the completed asset map and requiring critical-flow coverage.",
              ),
              evaluatePhase(
                "automated-evidence",
                [
	                  {
	                    label: "Evidence command coverage is sufficient",
	                    pass: evidence.commandsRun.length >= minimums.evidenceCommands,
	                    issue: `Automated evidence ran fewer than ${minimums.evidenceCommands} commands for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Scanner availability is explicitly handled",
	                    pass: scannerAvailabilityRecorded,
	                    issue: "Scanner availability was not recorded.",
	                  },
                  {
                    label: "No artifacts were created by read-only evidence collection",
                    pass: evidence.artifactsCreated.length === 0,
                    issue: "Automated evidence reported created artifacts.",
                  },
	                  {
	                    label: "Active scans are skipped when unauthorized",
	                    pass: scopePolicy.activeScanningAllowed || !ctx.input.allowActiveScanning || activeScanSkipped,
	                    issue: "Unauthorized active scan skips were not recorded.",
	                  },
                  {
                    label: "Scanner leads preserve CIA impact",
                    pass: evidence.scannerLeads.every((lead) => lead.ciaImpact.length > 0),
                    issue: "At least one scanner lead lacks CIA impact.",
                  },
                ],
                "Retry automated-evidence and require command/tool coverage plus explicit skip records.",
              ),
              evaluatePhase(
                "manual-review",
                [
                  {
                    label: "Manual review passes cover multiple risk areas",
                    pass: manualReview.reviewPasses.length >= 3,
                    issue: "Manual review covered too few distinct areas.",
                  },
	                  {
	                    label: "Manual review resolved findings or recorded why none were validated",
	                    pass:
	                      manualReview.validatedFindings.length > 0 ||
	                      manualReview.needsHumanConfirmation.length > 0 ||
	                      manualReview.falsePositivesOrWeakLeads.length > 0 ||
	                      manualReview.skippedAreas.length > 0,
	                    issue: "Manual review produced no findings, weak leads, human-confirmation items, or skipped-area explanation.",
	                  },
                  {
                    label: "Validated findings include affected assets and CIA impact",
                    pass: manualReview.validatedFindings.every(
                      (entry) => entry.affectedAssets.length > 0 && entry.ciaImpact.length > 0,
                    ),
                    issue: "At least one validated finding lacks affected assets or CIA impact.",
                  },
	                  {
	                    label: "Validated findings preserve line-level evidence",
	                    pass:
	                      manualReview.validatedFindings.length === 0 ||
	                      manualLineEvidenceCount / manualReview.validatedFindings.length >= 0.8,
	                    issue: "Fewer than 80% of validated findings include line-level evidence.",
	                  },
	                  {
	                    label: "Unconfirmed leads are separated from proven findings",
	                    pass:
	                      manualReview.needsHumanConfirmation.length > 0 ||
	                      manualReview.falsePositivesOrWeakLeads.length > 0 ||
	                      manualReview.validatedFindings.length === 0,
	                    issue: "Manual review did not record weak leads or human-confirmation items.",
	                  },
                ],
                "Retry manual-review with explicit line-evidence and confidence-separation requirements.",
              ),
              evaluatePhase(
                "finding-validation",
                [
                  {
                    label: "Every manual validated finding received a validation job",
                    pass: validationSummary.totalValidationJobs === manualReview.validatedFindings.length,
                    issue: "Validation job count does not match manual validated finding count.",
                  },
                  {
                    label: "Validation jobs preserve line-level evidence",
                    pass:
                      validationSummary.totalValidationJobs === 0 ||
                      validationLineEvidenceCount / validationSummary.totalValidationJobs >= 0.8,
                    issue: "Fewer than 80% of validation jobs include line-level evidence.",
                  },
                  {
                    label: "Validation jobs make an explicit disposition",
                    pass: validationSummary.jobs.every((job) => job.recommendedDisposition.length > 0),
                    issue: "At least one validation job lacks a disposition.",
                  },
                  {
                    label: "Validation confirms CIA impact",
                    pass: validationSummary.jobs.every((job) => job.ciaImpactConfirmed.length > 0),
                    issue: "At least one validation job lacks CIA impact confirmation.",
                  },
                  {
                    label: "Rejected or blocked findings are separated from kept findings",
                    pass:
                      validationSummary.downgradedOrRejectedFindings.length > 0 ||
                      validationSummary.needsHumanConfirmation.length > 0 ||
                      validationSummary.keptFindings.length === validationSummary.totalValidationJobs,
                    issue: "Validation summary did not separate kept, downgraded, rejected, or human-confirmation findings.",
                  },
                ],
                "Retry finding validation jobs with explicit falsification, line evidence, and disposition requirements.",
              ),
              evaluatePhase(
                "audit-report",
                [
                  {
                    label: "Report covers the manual validated finding set",
                    pass: manualReview.validatedFindings.every((entry) =>
                      reportFindingCategories.has(findingCategory(entry)),
                    ),
                    issue: "Report findings do not cover every manual-review finding category.",
                  },
                  {
                    label: "Report does not introduce unvalidated primary findings",
                    pass: reportOnlyFindings.length === 0,
                    issue: `Report introduced ${reportOnlyFindings.length} finding(s) that were not validated.`,
                  },
                  {
                    label: "Validated report retains all non-rejected manual findings",
                    pass: mergedFindings.length + rejectedValidationCount >= manualReview.validatedFindings.length,
                    issue: "Deterministic report merge dropped manual-review findings without validation rejection.",
                  },
	                  {
	                    label: "Merged report findings preserve line-level evidence where available",
	                    pass: mergedFindings.length === 0 || mergedLineEvidenceCount / mergedFindings.length >= 0.6,
	                    issue: "Merged report findings have insufficient line-level evidence.",
	                  },
	                  {
	                    label: "Prioritized backlog is actionable",
	                    pass: auditReport.prioritizedBacklog.length >= minimums.backlogItems,
	                    issue: `Prioritized backlog has fewer than ${minimums.backlogItems} items for ${ctx.input.auditMode} mode.`,
	                  },
	                  {
	                    label: "Scanner coverage and limitations are present",
                    pass: auditReport.scannerCoverage.length > 0 && auditReport.limitations.length > 0,
                    issue: "Scanner coverage or limitations are missing.",
                  },
	                  {
	                    label: "External inspection plan is preserved when needed",
	                    pass: auditReport.externalInspectionPlan.length > 0 || recordsAbsence(architectureContext),
	                    issue: "External inspection plan is missing from final report object without an explicit no-external-systems note.",
	                  },
                  {
                    label: "Deterministic report redacts secret-like values",
                    pass: !containsUnredactedSecretValue(reportPreview),
                    issue: "Rendered report still contains unredacted secret-like values.",
                  },
                  {
                    label: "Validation summary is available for final reporting",
                    pass: validationSummary.totalValidationJobs === manualReview.validatedFindings.length,
                    issue: "Final report does not have complete validation job coverage.",
                  },
                ],
                "Retry audit-report and deterministic report write; preserve manual evidence and structured limitations.",
              ),
            ];

            const overallScore = Math.round(
              phaseEvaluations.reduce((sum, phase) => sum + phase.score, 0) / phaseEvaluations.length,
            );
            const overallStatus =
              overallScore >= 85 ? ("pass" as const) : overallScore >= 60 ? ("warn" as const) : ("fail" as const);
            const replayRecommendations = phaseEvaluations
              .filter((phase) => phase.status !== "pass")
              .map((phase) => `${phase.phase}: ${phase.replayRecommendation}`);

            return {
              overallStatus,
              overallScore,
              phaseEvaluations,
              strongestSignals: [
                `${assetArchitectureMap.assets.length} assets, ${assetArchitectureMap.components.length} components, ${assetArchitectureMap.integrations.length} integrations, and ${assetArchitectureMap.dataFlows.length} data flows mapped.`,
                `${evidence.commandsRun.length} read-only evidence commands recorded; ${evidence.toolsMissing.length} scanner tools unavailable and recorded.`,
                `${manualReview.validatedFindings.length} validated findings with ${manualLineEvidenceCount} line-evidence-backed findings.`,
                `${validationSummary.totalValidationJobs} finding validation jobs completed with ${validationLineEvidenceCount} line-evidence-backed validation outputs.`,
                `${mergedFindings.length} final findings rendered from manual-review findings after applying validation disposition and severity adjustments.`,
              ],
              improvementNotes: [
                "Manual-review findings are treated as canonical for evidence-rich vulnerability details.",
                "Finding validation jobs independently try to falsify each manual finding before it reaches the final report.",
                "Unvalidated governance, dependency, telemetry, and external-control concerns stay in the inspection plan, limitations, backlog, or re-audit plan instead of primary findings.",
                "The quality gate is deterministic and can be used to decide whether to retry a weak phase before accepting the final report.",
              ],
              replayRecommendations:
                replayRecommendations.length > 0 ? replayRecommendations : ["No targeted replay recommended."],
            };
          }}
        </Task>
      ) : null}

      {scopePolicy && auditReport && validationSummary && qualityGate ? (
        <Task id="write-report-file" output={outputs.reportFile} noRetry>
          {() => {
            const reportPath = resolve(scopePolicy.outputDir, "audit-report.md");
            if (!isInside(scopePolicy.outputDir, reportPath)) {
              throw new Error(`Refusing to write report outside output directory: ${reportPath}`);
            }

            mkdirSync(scopePolicy.outputDir, { recursive: true });
            const mergedReport = {
              ...auditReport,
              findings: applyValidationToFindings(
                mergeValidatedFindings(manualReview?.validatedFindings ?? [], auditReport.findings),
                validationSummary,
              ),
            };
            const markdown = renderMarkdownReport(mergedReport, qualityGate, validationSummary);
            const content = `${markdown.trim()}\n`;
            writeFileSync(reportPath, content, "utf8");

            return {
              reportPath,
              artifactDirectory: scopePolicy.outputDir,
              bytes: Buffer.byteLength(content, "utf8"),
              status: "written" as const,
            };
          }}
        </Task>
      ) : null}
    </Workflow>
  );
});
