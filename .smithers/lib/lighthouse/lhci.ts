import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type {
  ApprovalPolicy,
  CodebaseReview,
  FinalReport,
  FinalReportDraft,
  FinalReportReview,
  HumanApproval,
  ImplementationResult,
  ImplementationReview,
  LighthouseComparison,
  LighthouseInput,
  LighthouseRun,
  LighthouseSummary,
  LocalRuntimeInput,
  PlanGate,
  PlanReview,
  RemediationPlan,
  TargetPlan,
  VerificationResult,
} from "./schemas";
import { lighthouseInputSchema } from "./schemas";

type CommandStatus = "passed" | "failed" | "skipped";
type LhciTarget = "local" | "prod";
type LhciPhase = "baseline" | "after";

type CommandResult = {
  label: string;
  command: string;
  cwd: string;
  status: CommandStatus;
  exitCode: number | null;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  summary: string;
};

type LhciSpec = {
  configPath: string;
  outputDir: string;
  scratchDir: string;
  formFactor: "mobile" | "desktop";
};

const DEFAULT_COMMAND_TIMEOUT_MS = 1000 * 60 * 10;
const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

const INPUT_ALIASES: Record<string, keyof LighthouseInput> = {
  repo_path: "repoPath",
  local_url: "localUrl",
  local_serve_command: "localServeCommand",
  build_command: "buildCommand",
  static_dist_dir: "staticDistDir",
  prod_url: "prodUrl",
  allow_prod_check: "allowProdCheck",
  number_of_runs: "numberOfRuns",
  form_factors: "formFactors",
  allow_implementation: "allowImplementation",
  approval_mode: "approvalMode",
  max_plan_review_iterations: "maxPlanReviewIterations",
  max_implementation_review_iterations: "maxImplementationReviewIterations",
  max_optimization_iterations: "maxOptimizationIterations",
  output_dir: "outputDir",
  app_profile: "appProfile",
};
const BOOLEAN_INPUT_KEYS = new Set<keyof LighthouseInput>([
  "allowProdCheck",
  "allowImplementation",
]);

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["[", "{"].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function coerceLighthouseInput(raw: unknown): LighthouseInput {
  if (!raw || typeof raw !== "object") {
    return lighthouseInputSchema.parse({});
  }

  const source = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "runId" || key === "run_id") continue;
    if (value === null || value === undefined) continue;
    const targetKey = INPUT_ALIASES[key] ?? key;
    const parsedValue = parseJsonString(value);
    normalized[targetKey] =
      BOOLEAN_INPUT_KEYS.has(targetKey as keyof LighthouseInput) && typeof parsedValue === "number"
        ? parsedValue === 1
        : parsedValue;
  }

  return lighthouseInputSchema.parse(normalized);
}

export function resolvePathFrom(baseDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed || trimmed === ".") return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function expandTargetUrls(baseUrl: string, routes: string[]): string[] {
  const normalizedRoutes = routes.length ? routes.map(normalizeRoute) : ["/"];
  return normalizedRoutes.map((route) => {
    if (/^https?:\/\//i.test(route)) return route;
    return new URL(route, ensureTrailingSlash(baseUrl)).toString();
  });
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function outputPath(repoPath: string, value: string): string {
  return resolvePathFrom(repoPath, value);
}

function emptyTarget(kind: LhciTarget, notes: string[] = []) {
  return {
    kind,
    enabled: false,
    mode: "skipped" as const,
    baseUrl: "",
    urls: [],
    routes: [],
    serveCommand: "",
    staticDistDir: "",
    notes,
  };
}

export function createTargetPlan(input: LighthouseInput): TargetPlan {
  const repoPath = resolve(input.repoPath);
  const routes = input.routes.length ? input.routes.map(normalizeRoute) : ["/"];
  const outputDir = outputPath(repoPath, input.outputDir);
  const scratchRoot = resolve(repoPath, ".smithers/tmp/lighthouse");
  const staticDistDir = input.staticDistDir ? resolvePathFrom(repoPath, input.staticDistDir) : "";
  const localMode = staticDistDir
    ? "static"
    : input.localServeCommand
      ? "server-command"
      : "url";
  const localBaseUrl = input.localUrl || "http://localhost:3000";
  const localUrls = localMode === "static" ? routes : expandTargetUrls(localBaseUrl, routes);
  const prodEnabled = Boolean(input.prodUrl && input.allowProdCheck);
  const prodBaseUrl = input.prodUrl ?? "";

  return {
    repoPath,
    outputDir,
    scratchRoot,
    numberOfRuns: input.numberOfRuns,
    formFactors: input.formFactors,
    categories: input.categories,
    thresholds: input.thresholds,
    buildCommand: input.buildCommand ?? "",
    local: {
      kind: "local",
      enabled: true,
      mode: localMode,
      baseUrl: localBaseUrl,
      urls: localUrls,
      routes,
      serveCommand: input.localServeCommand ?? "",
      staticDistDir,
      notes: [
        localMode === "url"
          ? "Using an already-running local URL; readiness is checked before LHCI."
          : localMode === "server-command"
            ? "LHCI will start the local server command from a scratch directory after changing into repoPath."
            : "LHCI will serve staticDistDir for local collection.",
      ],
    },
    prod: prodEnabled
      ? {
          kind: "prod",
          enabled: true,
          mode: "url",
          baseUrl: prodBaseUrl,
          urls: expandTargetUrls(prodBaseUrl, routes),
          routes,
          serveCommand: "",
          staticDistDir: "",
          notes: ["Production check is authorized and observational."],
        }
      : emptyTarget(
          "prod",
          input.prodUrl
            ? ["Production URL was provided but allowProdCheck is false, so prod LHCI is skipped."]
            : ["No production URL provided."],
        ),
    approvalMode: input.approvalMode,
    allowImplementation: input.allowImplementation,
    maxPlanReviewIterations: input.maxPlanReviewIterations,
    maxImplementationReviewIterations: input.maxImplementationReviewIterations,
    maxOptimizationIterations: input.maxOptimizationIterations,
    appProfile: input.appProfile ?? "",
  };
}

export function mergeLocalRuntimeInput(
  input: LighthouseInput,
  runtimeInput?: LocalRuntimeInput,
): TargetPlan {
  if (!runtimeInput) return createTargetPlan(input);

  return createTargetPlan({
    ...input,
    localUrl: runtimeInput.localUrl ?? input.localUrl,
    localServeCommand: runtimeInput.localServeCommand ?? input.localServeCommand,
    staticDistDir: runtimeInput.staticDistDir ?? input.staticDistDir,
    buildCommand: runtimeInput.buildCommand ?? input.buildCommand,
  });
}

export async function checkServerReady(url: string): Promise<{
  satisfied: boolean;
  checkedUrl: string;
  statusCode: number | null;
  error: string;
}> {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    return {
      satisfied: response.status >= 200 && response.status < 500,
      checkedUrl: url,
      statusCode: response.status,
      error: "",
    };
  } catch (error) {
    return {
      satisfied: false,
      checkedUrl: url,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function detectChromeExecutable(): Promise<string> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  for (const candidate of CHROME_CANDIDATES) {
    if (await stat(candidate).catch(() => null)) return candidate;
  }

  return "";
}

function formFactorSettings(formFactor: "mobile" | "desktop") {
  if (formFactor === "mobile") return {};

  return {
    formFactor: "desktop",
    screenEmulation: {
      mobile: false,
      width: 1350,
      height: 940,
      deviceScaleFactor: 1,
      disabled: false,
    },
  };
}

function assertionKey(category: string): string {
  return category === "best-practices" ? "best-practices" : category;
}

function thresholdFor(plan: TargetPlan, category: string): number {
  if (category === "best-practices") return plan.thresholds.bestPractices;
  if (category === "accessibility") return plan.thresholds.accessibility;
  if (category === "seo") return plan.thresholds.seo;
  return plan.thresholds.performance;
}

export function buildLhciConfig(
  plan: TargetPlan,
  target: LhciTarget,
  phase: LhciPhase,
  formFactor: "mobile" | "desktop",
  outputDir: string,
) {
  const targetPlan = target === "local" ? plan.local : plan.prod;
  const collect: Record<string, unknown> = {
    url: targetPlan.urls,
    numberOfRuns: plan.numberOfRuns,
    settings: {
      onlyCategories: plan.categories,
      chromeFlags: "--headless --no-sandbox",
      ...formFactorSettings(formFactor),
    },
  };

  if (target === "local" && targetPlan.mode === "server-command") {
    collect.startServerCommand = `cd ${shellQuote(plan.repoPath)} && ${targetPlan.serveCommand}`;
  }

  if (target === "local" && targetPlan.mode === "static") {
    collect.staticDistDir = targetPlan.staticDistDir;
  }

  return {
    ci: {
      collect,
      assert: {
        preset: "lighthouse:recommended",
        assertions: Object.fromEntries(
          plan.categories.map((category) => [
            `categories:${assertionKey(category)}`,
            ["warn", { minScore: thresholdFor(plan, category) }],
          ]),
        ),
      },
      upload: {
        target: "filesystem",
        outputDir,
      },
    },
  };
}

function configText(config: unknown): string {
  return `module.exports = ${JSON.stringify(config, null, 2)};\n`;
}

export async function createLhciSpecs(
  plan: TargetPlan,
  target: LhciTarget,
  phase: LhciPhase,
): Promise<LhciSpec[]> {
  const specs: LhciSpec[] = [];

  for (const formFactor of plan.formFactors) {
    const slug = `${target}-${phase}-${formFactor}`;
    const scratchDir = join(plan.scratchRoot, slug);
    const outputDir = join(plan.outputDir, slug);
    const configPath = join(scratchDir, "lighthouserc.cjs");
    const config = buildLhciConfig(plan, target, phase, formFactor, outputDir);

    await mkdir(scratchDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(configPath, configText(config), "utf8");
    specs.push({ configPath, outputDir, scratchDir, formFactor });
  }

  return specs;
}

export async function runCommand(
  label: string,
  command: string,
  cwd: string,
  artifactDir: string,
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  await mkdir(artifactDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_.-]+/gi, "-").toLowerCase();
  const stdoutPath = join(artifactDir, `${safeLabel}.stdout.log`);
  const stderrPath = join(artifactDir, `${safeLabel}.stderr.log`);

  const timeout = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      stderr += `\nCommand timed out after ${timeout}ms.`;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      resolveResult({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });

  await writeFile(stdoutPath, result.stdout, "utf8");
  await writeFile(stderrPath, result.stderr, "utf8");
  const durationMs = Date.now() - startedAt;
  const status = result.code === 0 ? "passed" : "failed";
  const summary =
    status === "passed"
      ? `${label} passed in ${durationMs}ms.`
      : `${label} failed with exit code ${result.code ?? "unknown"} in ${durationMs}ms.`;

  return {
    label,
    command,
    cwd,
    status: options.allowFailure ? (status as CommandStatus) : status,
    exitCode: result.code,
    durationMs,
    stdoutPath,
    stderrPath,
    summary,
  };
}

async function findFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(current, entry);
      const entryStat = await stat(path).catch(() => null);
      if (!entryStat) continue;
      if (entryStat.isDirectory()) {
        await walk(path);
      } else if (predicate(path)) {
        found.push(path);
      }
    }
  }

  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

export async function runLighthouseTarget(
  plan: TargetPlan,
  target: LhciTarget,
  phase: LhciPhase,
): Promise<LighthouseRun> {
  const targetPlan = target === "local" ? plan.local : plan.prod;
  if (!targetPlan.enabled) {
    return {
      target,
      phase,
      status: "skipped",
      configPaths: [],
      artifactDirectories: [],
      scratchDirectories: [],
      manifestPaths: [],
      reportFiles: [],
      commands: [],
      notes: targetPlan.notes,
    };
  }

  const chromePath = await detectChromeExecutable();
  if (!chromePath) {
    return {
      target,
      phase,
      status: "failed",
      configPaths: [],
      artifactDirectories: [],
      scratchDirectories: [],
      manifestPaths: [],
      reportFiles: [],
      commands: [],
      notes: [
        ...targetPlan.notes,
        "Chrome/Chromium was not found. Install Chrome/Chromium or set CHROME_PATH before running LHCI.",
      ],
    };
  }

  const commands: CommandResult[] = [];
  const specs = await createLhciSpecs(plan, target, phase);

  if (target === "local" && plan.buildCommand) {
    commands.push(
      await runCommand("build", plan.buildCommand, plan.repoPath, join(plan.outputDir, "command-logs")),
    );
  }

  for (const spec of specs) {
    const lhci = "npx -y -p @lhci/cli lhci";
    commands.push(
      await runCommand(
        `${target}-${phase}-${spec.formFactor}-collect`,
        `${lhci} collect --config=${shellQuote(spec.configPath)}`,
        spec.scratchDir,
        join(spec.outputDir, "command-logs"),
        { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS },
      ),
    );
    commands.push(
      await runCommand(
        `${target}-${phase}-${spec.formFactor}-assert`,
        `${lhci} assert --config=${shellQuote(spec.configPath)}`,
        spec.scratchDir,
        join(spec.outputDir, "command-logs"),
        { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS, allowFailure: true },
      ),
    );
    commands.push(
      await runCommand(
        `${target}-${phase}-${spec.formFactor}-upload`,
        `${lhci} upload --config=${shellQuote(spec.configPath)} --target=filesystem --outputDir=${shellQuote(spec.outputDir)}`,
        spec.scratchDir,
        join(spec.outputDir, "command-logs"),
        { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS, allowFailure: true },
      ),
    );
  }

  const isCandidateReportJson = (path: string) => {
    const name = basename(path);
    return path.endsWith(".json") && name !== "manifest.json" && name !== "assertion-results.json";
  };
  const reportFilesNested = await Promise.all(
    specs.map((spec) =>
      findFiles(
        spec.outputDir,
        (path) => isCandidateReportJson(path) || path.endsWith(".report.html"),
      ),
    ),
  );
  const manifestFilesNested = await Promise.all(
    specs.map(async (spec) => {
      const outputManifests = await findFiles(spec.outputDir, (path) => basename(path) === "manifest.json");
      const scratchManifests = await findFiles(spec.scratchDir, (path) => basename(path) === "manifest.json");
      return [...outputManifests, ...scratchManifests];
    }),
  );
  const reportFiles = reportFilesNested.flat().filter(isCandidateReportJson);
  const manifestPaths = manifestFilesNested.flat();
  const collectFailed = commands.some((command) => command.label.includes("collect") && command.status === "failed");

  return {
    target,
    phase,
    status: reportFiles.length > 0 && !collectFailed ? "ran" : "failed",
    configPaths: specs.map((spec) => spec.configPath),
    artifactDirectories: specs.map((spec) => spec.outputDir),
    scratchDirectories: specs.map((spec) => spec.scratchDir),
    manifestPaths,
    reportFiles,
    commands,
    notes: [
      ...targetPlan.notes,
      collectFailed ? "At least one LHCI collect command failed." : "",
      reportFiles.length === 0 ? "No Lighthouse JSON report files were found." : "",
    ].filter(Boolean),
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function auditSummary(id: string, audit: Record<string, unknown>) {
  const details = audit.details && typeof audit.details === "object" ? (audit.details as Record<string, unknown>) : {};
  return {
    id,
    title: stringValue(audit.title) || id,
    score: asNumber(audit.score),
    displayValue: stringValue(audit.displayValue),
    numericValue: asNumber(audit.numericValue),
    savingsMs: asNumber(details.overallSavingsMs),
    description: stringValue(audit.description),
  };
}

function categoryScores(lhr: Record<string, unknown>) {
  const categories = lhr.categories && typeof lhr.categories === "object" ? (lhr.categories as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(categories).map(([key, value]) => {
      const category = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      return [key, asNumber(category.score)];
    }),
  );
}

function metrics(audits: Record<string, Record<string, unknown>>) {
  const metricIds = {
    fcp: "first-contentful-paint",
    lcp: "largest-contentful-paint",
    cls: "cumulative-layout-shift",
    tbt: "total-blocking-time",
    speedIndex: "speed-index",
    tti: "interactive",
    ttfb: "server-response-time",
  };

  return Object.fromEntries(
    Object.entries(metricIds).map(([key, auditId]) => [key, asNumber(audits[auditId]?.numericValue)]),
  );
}

function collectAuditGroups(audits: Record<string, Record<string, unknown>>) {
  const all = Object.entries(audits).map(([id, audit]) => auditSummary(id, audit));
  const opportunities = all
    .filter((audit) => audit.savingsMs !== null && audit.savingsMs > 0)
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 15);
  const failedAudits = all
    .filter((audit) => audit.score !== null && audit.score < 0.9)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 20);
  const diagnostics = all
    .filter((audit) => audit.score === null && (audit.displayValue || audit.numericValue !== null))
    .slice(0, 15);

  return { opportunities, failedAudits, diagnostics };
}

export async function summarizeLighthouseRuns(
  target: "local" | "prod" | "combined",
  phase: "baseline" | "after",
  runs: LighthouseRun[],
): Promise<LighthouseSummary> {
  const activeRuns = runs.filter((run) => run.status !== "skipped");
  const reportFiles = activeRuns.flatMap((run) => run.reportFiles).filter((path) => path.endsWith(".json"));
  const pages = [];

  for (const reportFile of reportFiles) {
    const raw = await readFile(reportFile, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    let lhr: Record<string, unknown>;
    try {
      lhr = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!lhr.categories || !lhr.audits) continue;
    const audits = lhr.audits as Record<string, Record<string, unknown>>;
    const groups = collectAuditGroups(audits);
    const configSettings =
      lhr.configSettings && typeof lhr.configSettings === "object"
        ? (lhr.configSettings as Record<string, unknown>)
        : {};
    const runtimeError =
      lhr.runtimeError && typeof lhr.runtimeError === "object"
        ? stringValue((lhr.runtimeError as Record<string, unknown>).message)
        : "";

    pages.push({
      sourcePath: reportFile,
      requestedUrl: stringValue(lhr.requestedUrl),
      finalUrl: stringValue(lhr.finalUrl),
      formFactor: stringValue(configSettings.formFactor) || "mobile",
      fetchTime: stringValue(lhr.fetchTime),
      lighthouseVersion: stringValue(lhr.lighthouseVersion),
      categoryScores: categoryScores(lhr),
      metrics: metrics(audits),
      opportunities: groups.opportunities,
      failedAudits: groups.failedAudits,
      diagnostics: groups.diagnostics,
      runtimeError,
      warnings: Array.isArray(lhr.runWarnings) ? lhr.runWarnings.map(String) : [],
    });
  }

  if (pages.length === 0) {
    return {
      target,
      phase,
      status: activeRuns.length ? "empty" : "skipped",
      representativeReportPath: "",
      representativeUrl: "",
      categoryScores: {},
      metrics: {},
      pages: [],
      topOpportunities: [],
      failedAudits: [],
      diagnostics: [],
      runtimeErrors: [],
      warnings: [],
      artifactDirectories: runs.flatMap((run) => run.artifactDirectories),
      notes: runs.flatMap((run) => run.notes),
    };
  }

  const sorted = [...pages].sort((a, b) => {
    const aScore = a.categoryScores.performance ?? 0;
    const bScore = b.categoryScores.performance ?? 0;
    return aScore - bScore;
  });
  const representative = sorted[Math.floor(sorted.length / 2)];
  const topOpportunities = pages.flatMap((page) => page.opportunities).sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));
  const failedAudits = pages.flatMap((page) => page.failedAudits).sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
  const diagnostics = pages.flatMap((page) => page.diagnostics);

  return {
    target,
    phase,
    status: "parsed",
    representativeReportPath: representative.sourcePath,
    representativeUrl: representative.finalUrl || representative.requestedUrl,
    categoryScores: representative.categoryScores,
    metrics: representative.metrics,
    pages,
    topOpportunities: topOpportunities.slice(0, 20),
    failedAudits: failedAudits.slice(0, 20),
    diagnostics: diagnostics.slice(0, 20),
    runtimeErrors: pages.map((page) => page.runtimeError).filter(Boolean),
    warnings: pages.flatMap((page) => page.warnings),
    artifactDirectories: runs.flatMap((run) => run.artifactDirectories),
    notes: runs.flatMap((run) => run.notes),
  };
}

function scoreDelta(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  return Number((after - before).toFixed(3));
}

function metricDelta(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  return Number((after - before).toFixed(1));
}

function thresholdEntries(plan: TargetPlan): Array<[string, number]> {
  return [
    ["performance", plan.thresholds.performance],
    ["accessibility", plan.thresholds.accessibility],
    ["best-practices", plan.thresholds.bestPractices],
    ["seo", plan.thresholds.seo],
  ];
}

export function compareLighthouseSummaries(
  plan: TargetPlan,
  baseline: LighthouseSummary,
  after?: LighthouseSummary,
): LighthouseComparison {
  if (!after || after.status !== "parsed") {
    return {
      status: "not-run",
      greatEnough: false,
      categoryDeltas: {},
      metricDeltas: {},
      improvements: [],
      regressions: [],
      remainingIssues: baseline.failedAudits.slice(0, 8).map((audit) => audit.title),
      recommendation: "After-change Lighthouse has not run yet.",
    };
  }

  const categoryDeltas = Object.fromEntries(
    Object.keys({ ...baseline.categoryScores, ...after.categoryScores }).map((key) => [
      key,
      scoreDelta(baseline.categoryScores[key], after.categoryScores[key]),
    ]),
  );
  const metricDeltas = Object.fromEntries(
    Object.keys({ ...baseline.metrics, ...after.metrics }).map((key) => [
      key,
      metricDelta(baseline.metrics[key], after.metrics[key]),
    ]),
  );
  const belowThreshold = thresholdEntries(plan).filter(([category, threshold]) => {
    const score = after.categoryScores[category];
    return typeof score === "number" && score < threshold;
  });
  const regressions = Object.entries(categoryDeltas)
    .filter(([, delta]) => typeof delta === "number" && delta < -0.02)
    .map(([category, delta]) => `${category} regressed by ${delta}`);
  const improvements = Object.entries(categoryDeltas)
    .filter(([, delta]) => typeof delta === "number" && delta > 0.02)
    .map(([category, delta]) => `${category} improved by ${delta}`);
  const remainingIssues = [
    ...belowThreshold.map(([category, threshold]) => `${category} remains below ${threshold}`),
    ...after.failedAudits.slice(0, 8).map((audit) => audit.title),
    ...after.runtimeErrors,
  ];
  const greatEnough = remainingIssues.length === 0 && regressions.length === 0;

  return {
    status: greatEnough ? "great" : "needs-iteration",
    greatEnough,
    categoryDeltas,
    metricDeltas,
    improvements,
    regressions,
    remainingIssues,
    recommendation: greatEnough
      ? "Local Lighthouse is in a good state; stop iterating."
      : "Create another focused plan only if remaining issues are local and worth the change risk.",
  };
}

export function determineApprovalPolicy(
  plan: TargetPlan,
  remediationPlan: RemediationPlan,
  review: PlanReview,
): ApprovalPolicy {
  if (plan.approvalMode === "never") {
    return { requiresHumanApproval: false, reason: "approvalMode is never." };
  }

  if (plan.approvalMode === "always") {
    return { requiresHumanApproval: true, reason: "approvalMode is always." };
  }

  if (!review.approved) {
    return { requiresHumanApproval: false, reason: "Plan review is not approved yet." };
  }

  const riskyWork =
    remediationPlan.requiresHumanApproval ||
    remediationPlan.riskLevel === "high" ||
    remediationPlan.riskLevel === "critical" ||
    remediationPlan.workItems.some((item) => item.requiresApproval);

  return {
    requiresHumanApproval: riskyWork,
    reason: riskyWork
      ? "Plan has high-risk, broad, or explicitly approval-required changes."
      : "Plan is reviewer-approved and low-risk enough for auto implementation.",
  };
}

export function evaluatePlanGate(
  review: PlanReview | undefined,
  policy: ApprovalPolicy | undefined,
  approval: HumanApproval | undefined,
): PlanGate {
  if (!review) {
    return {
      ready: false,
      shouldImplement: false,
      feedbackForNextPlan: ["Plan review has not completed."],
      reason: "Waiting for plan review.",
    };
  }

  if (!review.approved) {
    return {
      ready: false,
      shouldImplement: false,
      feedbackForNextPlan: review.requiredChanges,
      reason: "Plan reviewers requested changes.",
    };
  }

  if (review.iterationNeeded) {
    return {
      ready: false,
      shouldImplement: false,
      feedbackForNextPlan: review.requiredChanges,
      reason: "Plan reviewers approved the direction but requested another plan iteration.",
    };
  }

  if (policy?.requiresHumanApproval) {
    if (!approval) {
      return {
        ready: false,
        shouldImplement: false,
        feedbackForNextPlan: ["Human approval is required and has not been received."],
        reason: "Waiting for human approval.",
      };
    }

    if (!approval.approved) {
      return {
        ready: false,
        shouldImplement: false,
        feedbackForNextPlan: [
          approval.feedback,
          ...approval.requiredChanges,
        ].filter(Boolean),
        reason: "Human approval was denied or requested changes.",
      };
    }
  }

  return {
    ready: true,
    shouldImplement: true,
    feedbackForNextPlan: [],
    reason: policy?.reason ?? "Plan ready.",
  };
}

export async function discoverVerificationCommands(
  plan: TargetPlan,
): Promise<{ commands: string[]; missingCommands: string[] }> {
  const packageJsonPath = join(plan.repoPath, "package.json");
  const raw = await readFile(packageJsonPath, "utf8").catch(() => "");
  const commands: string[] = [];
  const missingCommands: string[] = [];
  const packageManager = await detectPackageManager(plan.repoPath);
  const runner = packageManager === "npm" ? "npm run" : `${packageManager} run`;

  if (!raw.trim()) {
    return { commands: plan.buildCommand ? [plan.buildCommand] : [], missingCommands: ["package.json"] };
  }

  const packageJson = JSON.parse(raw) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  for (const script of ["typecheck", "lint", "test", "build"]) {
    if (scripts[script]) {
      const command = script === "build" && plan.buildCommand ? plan.buildCommand : `${runner} ${script}`;
      if (!commands.includes(command)) commands.push(command);
    } else {
      missingCommands.push(script);
    }
  }

  if (plan.buildCommand && !commands.includes(plan.buildCommand)) {
    commands.push(plan.buildCommand);
  }

  return { commands, missingCommands };
}

async function detectPackageManager(repoPath: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const exists = async (path: string) => Boolean(await stat(join(repoPath, path)).catch(() => null));
  if (await exists("pnpm-lock.yaml")) return "pnpm";
  if (await exists("yarn.lock")) return "yarn";
  if (await exists("bun.lock") || await exists("bun.lockb")) return "bun";
  return "npm";
}

export async function runVerification(plan: TargetPlan): Promise<VerificationResult> {
  const { commands, missingCommands } = await discoverVerificationCommands(plan);
  const results: CommandResult[] = [];
  for (const command of commands) {
    results.push(
      await runCommand(
        `verify-${command.split(/\s+/).slice(-1)[0] ?? "command"}`,
        command,
        plan.repoPath,
        join(plan.outputDir, "verification-logs"),
        { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS, allowFailure: true },
      ),
    );
  }

  const passed = results.every((result) => result.status === "passed");
  return {
    passed,
    commands: results,
    missingCommands,
    summary: results.length
      ? `${results.filter((result) => result.status === "passed").length}/${results.length} verification commands passed.`
      : "No verification commands were discovered.",
  };
}

export async function writeFinalReport(
  plan: TargetPlan,
  baseline: LighthouseSummary,
  after: LighthouseSummary | undefined,
  comparison: LighthouseComparison | undefined,
  verification: VerificationResult | undefined,
  implementationReview: ImplementationReview | undefined,
): Promise<FinalReport> {
  const draft = buildFinalReportDraft({
    plan,
    baseline,
    after,
    comparison,
    verification,
    implementationReview,
  });
  return writeReviewedFinalReport(plan, draft);
}

type FinalReportDraftArgs = {
  plan: TargetPlan;
  baseline: LighthouseSummary;
  prodSummary?: LighthouseSummary;
  after?: LighthouseSummary;
  comparison?: LighthouseComparison;
  verification?: VerificationResult;
  implementationReview?: ImplementationReview;
  implementationResult?: ImplementationResult;
  codebaseReview?: CodebaseReview;
  remediationPlan?: RemediationPlan;
  planReview?: PlanReview;
  approvalPolicy?: ApprovalPolicy;
  humanApproval?: HumanApproval;
  planGate?: PlanGate;
  previousReview?: FinalReportReview;
};

function formatScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}/100 (${value.toFixed(2)})`;
}

function formatAuditScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toFixed(2);
}

function formatDelta(value: number | null | undefined, kind: "score" | "metric"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const prefix = value > 0 ? "+" : "";
  return kind === "score" ? `${prefix}${value.toFixed(3)}` : `${prefix}${value.toFixed(1)}`;
}

function formatMetric(name: string, value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (name === "cls") return value.toFixed(3);
  return `${Math.round(value)} ms`;
}

function thresholdForCategory(plan: TargetPlan, category: string): number {
  if (category === "accessibility") return plan.thresholds.accessibility;
  if (category === "best-practices") return plan.thresholds.bestPractices;
  if (category === "seo") return plan.thresholds.seo;
  return plan.thresholds.performance;
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\n+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function markdownTable(headers: string[], rows: string[][], emptyText = "_None recorded._"): string {
  if (rows.length === 0) return emptyText;
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

function bulletList(items: string[], fallback = "None recorded."): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  return clean.length ? clean.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function truncate(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function reportStatus(args: FinalReportDraftArgs): FinalReportDraft["status"] {
  if (args.baseline.status !== "parsed") return "blocked";
  if (args.comparison?.status === "blocked") return "blocked";
  if (args.comparison?.greatEnough) return "completed";
  if (!args.plan.allowImplementation || args.implementationResult?.status === "skipped") return "plan-only";
  if (args.comparison?.status === "needs-iteration") return "blocked";
  return "plan-only";
}

function beforeAfterSummary(baseline: LighthouseSummary, after?: LighthouseSummary): string {
  const before = formatScore(baseline.categoryScores.performance);
  if (!after || after.status !== "parsed") {
    return `Baseline performance is ${before}; no after-change Lighthouse run was available.`;
  }

  return `Baseline performance is ${before}; after-change performance is ${formatScore(after.categoryScores.performance)}.`;
}

function categoryRows(plan: TargetPlan, baseline: LighthouseSummary, after?: LighthouseSummary, comparison?: LighthouseComparison): string[][] {
  const categories = Array.from(new Set([
    ...plan.categories,
    ...Object.keys(baseline.categoryScores),
    ...Object.keys(after?.categoryScores ?? {}),
  ]));

  return categories.map((category) => {
    const afterScore = after?.categoryScores[category];
    const threshold = thresholdForCategory(plan, category);
    const effectiveScore = typeof afterScore === "number" ? afterScore : baseline.categoryScores[category];
    return [
      category,
      formatScore(baseline.categoryScores[category]),
      after?.status === "parsed" ? formatScore(afterScore) : "not run",
      formatDelta(comparison?.categoryDeltas[category], "score"),
      formatScore(threshold),
      typeof effectiveScore === "number" && effectiveScore >= threshold ? "meets" : "below",
    ];
  });
}

function metricRows(baseline: LighthouseSummary, after?: LighthouseSummary, comparison?: LighthouseComparison): string[][] {
  const metrics = [
    ["fcp", "First Contentful Paint"],
    ["lcp", "Largest Contentful Paint"],
    ["cls", "Cumulative Layout Shift"],
    ["tbt", "Total Blocking Time"],
    ["speedIndex", "Speed Index"],
    ["ttfb", "Server Response Time"],
    ["tti", "Time to Interactive"],
  ];

  return metrics.map(([key, label]) => [
    label,
    formatMetric(key, baseline.metrics[key]),
    after?.status === "parsed" ? formatMetric(key, after.metrics[key]) : "not run",
    formatDelta(comparison?.metricDeltas[key], "metric"),
  ]);
}

function failedAuditRows(summary: LighthouseSummary): string[][] {
  return summary.failedAudits.slice(0, 12).map((audit) => [
    audit.id,
    audit.title,
    formatAuditScore(audit.score),
    audit.displayValue || (audit.numericValue === null ? "" : String(audit.numericValue)),
    truncate(audit.description),
  ]);
}

function opportunityRows(summary: LighthouseSummary): string[][] {
  return summary.topOpportunities.slice(0, 10).map((audit) => [
    audit.id,
    audit.title,
    audit.savingsMs === null ? "n/a" : `${Math.round(audit.savingsMs)} ms`,
    audit.displayValue,
  ]);
}

function rootCauseRows(review?: CodebaseReview): string[][] {
  return (review?.likelyRootCauses ?? []).map((cause) => [
    cause.issue,
    truncate(cause.evidence),
    cause.files.join(", ") || "n/a",
    truncate(cause.suggestedDirection),
  ]);
}

function workItemRows(plan?: RemediationPlan): string[][] {
  return (plan?.workItems ?? []).map((item) => [
    item.priority,
    item.title,
    truncate(item.lighthouseEvidence),
    item.filesExpectedToChange.join(", ") || "n/a",
    truncate(item.implementationApproach),
    item.verification.join("; ") || "n/a",
  ]);
}

function commandRows(verification?: VerificationResult): string[][] {
  return (verification?.commands ?? []).map((command) => [
    command.label,
    command.status,
    String(command.exitCode ?? "n/a"),
    command.command,
    command.stdoutPath,
    command.stderrPath,
  ]);
}

function comparisonRows(comparison?: LighthouseComparison): string[][] {
  if (!comparison) return [];
  return [
    ["status", comparison.status],
    ["greatEnough", String(comparison.greatEnough)],
    ["recommendation", comparison.recommendation],
  ];
}

function artifactLines(args: FinalReportDraftArgs): string[] {
  return [
    `Output directory: ${args.plan.outputDir}`,
    `Local baseline representative JSON: ${args.baseline.representativeReportPath || "n/a"}`,
    `Local after representative JSON: ${args.after?.representativeReportPath || "n/a"}`,
    `Production representative JSON: ${args.prodSummary?.representativeReportPath || "n/a"}`,
    ...args.baseline.artifactDirectories.map((dir) => `Local baseline artifact directory: ${dir}`),
    ...(args.after?.artifactDirectories ?? []).map((dir) => `Local after artifact directory: ${dir}`),
    ...(args.prodSummary?.artifactDirectories ?? []).map((dir) => `Production artifact directory: ${dir}`),
  ];
}

function collectLimitations(args: FinalReportDraftArgs): string[] {
  return [
    args.plan.prod.enabled ? "Production results are context only unless the URL is a preview for the current code." : "Production Lighthouse was not run or was not authorized.",
    args.after?.status === "parsed" ? "" : "No after-change Lighthouse report was available.",
    args.verification ? "" : "Repo-native verification did not run.",
    args.verification?.passed === false ? "One or more verification commands failed or were inconclusive." : "",
    ...(args.verification?.missingCommands ?? []).map((command) => `No ${command} script was discovered.`),
    args.baseline.status === "parsed" ? "" : "Local baseline Lighthouse did not produce parseable report JSON.",
  ].filter(Boolean);
}

export function buildFinalReportDraft(args: FinalReportDraftArgs): FinalReportDraft {
  const status = reportStatus(args);
  const remainingIssues =
    args.comparison?.remainingIssues.length
      ? args.comparison.remainingIssues
      : args.baseline.failedAudits.slice(0, 10).map((audit) => audit.title);
  const implementedChanges =
    args.implementationResult?.status === "implemented"
      ? [
          args.implementationResult.summary,
          ...args.implementationResult.filesChanged.map((file) => `Changed ${file}`),
          ...args.implementationResult.notes,
        ].filter(Boolean)
      : [];
  const verificationSummary = args.verification?.summary ?? "Verification did not run.";
  const beforeAfter = beforeAfterSummary(args.baseline, args.after);
  const limitations = collectLimitations(args);
  const summary =
    args.baseline.status !== "parsed"
      ? "Local Lighthouse did not produce a parsed report, so remediation planning could not be completed."
      : status === "completed"
        ? "Local Lighthouse was re-run after implementation and the configured thresholds are satisfied."
        : status === "plan-only"
          ? "Local Lighthouse was collected and reviewed; implementation was skipped or disabled, so this report is a reviewed remediation plan."
          : "The workflow found useful improvements but did not reach a final green state within the configured gates.";
  const previousFeedback = args.previousReview?.approved === false
    ? args.previousReview.requiredChanges
    : [];
  const reviewerMarkdown = args.previousReview?.approved === false
    ? args.previousReview.improvedMarkdown?.trim()
    : "";

  const markdown = reviewerMarkdown || [
    "# Lighthouse Check Report",
    "",
    `Status: ${status}`,
    `Generated artifact directory: ${args.plan.outputDir}`,
    "",
    "## Executive Summary",
    summary,
    "",
    `- Local target: ${args.plan.local.baseUrl || "n/a"} (${args.plan.local.mode})`,
    `- Routes checked: ${args.plan.local.routes.join(", ") || "n/a"}`,
    `- Production target: ${args.plan.prod.enabled ? args.plan.prod.baseUrl : "skipped"}`,
    `- Runs per URL/form factor: ${args.plan.numberOfRuns}`,
    `- Form factors: ${args.plan.formFactors.join(", ")}`,
    `- Categories: ${args.plan.categories.join(", ")}`,
    "",
    "## Score Summary",
    markdownTable(
      ["Category", "Baseline", "After", "Delta", "Threshold", "State"],
      categoryRows(args.plan, args.baseline, args.after, args.comparison),
    ),
    "",
    "## Key Metrics",
    markdownTable(
      ["Metric", "Baseline", "After", "Delta"],
      metricRows(args.baseline, args.after, args.comparison),
    ),
    "",
    "## Biggest Lighthouse Issues",
    markdownTable(
      ["Audit ID", "Title", "Score", "Display", "Description"],
      failedAuditRows(args.baseline),
      "_No failed baseline audits were recorded._",
    ),
    "",
    "## Top Opportunities",
    markdownTable(
      ["Audit ID", "Title", "Estimated Savings", "Display"],
      opportunityRows(args.baseline),
      "_No Lighthouse opportunities were recorded._",
    ),
    "",
    "## Codebase Review",
    args.codebaseReview?.summary ?? "Codebase review was not available.",
    "",
    `- Framework: ${args.codebaseReview?.framework || "unknown"}`,
    `- Package manager: ${args.codebaseReview?.packageManager || "unknown"}`,
    `- Important files: ${args.codebaseReview?.importantFiles.join(", ") || "n/a"}`,
    "",
    markdownTable(
      ["Issue", "Evidence", "Files", "Suggested Direction"],
      rootCauseRows(args.codebaseReview),
      "_No codebase root-cause mapping was recorded._",
    ),
    "",
    "## Remediation Plan",
    args.remediationPlan?.summary ?? "No remediation plan was produced.",
    "",
    args.remediationPlan
      ? [
          `- Risk level: ${args.remediationPlan.riskLevel}`,
          `- Requires human approval: ${args.remediationPlan.requiresHumanApproval}`,
          `- Approval rationale: ${args.remediationPlan.approvalRationale}`,
        ].join("\n")
      : "- No plan metadata recorded.",
    "",
    markdownTable(
      ["Priority", "Title", "Lighthouse Evidence", "Files", "Approach", "Verification"],
      workItemRows(args.remediationPlan),
      "_No remediation work items were recorded._",
    ),
    "",
    "## Review And Approval",
    `- Plan review: ${args.planReview?.approved === true ? "approved" : args.planReview?.approved === false ? "changes requested" : "not run"}`,
    `- Plan review summary: ${args.planReview?.summary || "n/a"}`,
    `- Approval policy: ${args.approvalPolicy?.reason || "n/a"}`,
    `- Human approval: ${args.humanApproval ? (args.humanApproval.approved ? "approved" : "denied or changes requested") : "not required or not requested"}`,
    `- Plan gate: ${args.planGate?.ready === true ? "ready" : args.planGate?.ready === false ? "not ready" : "not evaluated"}`,
    "",
    "Required plan changes:",
    bulletList(args.planReview?.requiredChanges ?? []),
    "",
    "## Implementation And Verification",
    `- Implementation status: ${args.implementationResult?.status ?? "not run"}`,
    `- Implementation summary: ${args.implementationResult?.summary ?? "n/a"}`,
    `- Implementation review: ${args.implementationReview?.approved === true ? "approved" : args.implementationReview?.approved === false ? "changes requested" : "not run"}`,
    `- Verification summary: ${verificationSummary}`,
    "",
    "Implemented changes:",
    bulletList(implementedChanges),
    "",
    markdownTable(
      ["Label", "Status", "Exit", "Command", "Stdout", "Stderr"],
      commandRows(args.verification),
      "_No verification commands were run._",
    ),
    "",
    "## Before / After Comparison",
    beforeAfter,
    "",
    markdownTable(
      ["Field", "Value"],
      comparisonRows(args.comparison),
      "_No after-change comparison was available._",
    ),
    "",
    "Improvements:",
    bulletList(args.comparison?.improvements ?? []),
    "",
    "Regressions:",
    bulletList(args.comparison?.regressions ?? []),
    "",
    "Remaining issues:",
    bulletList(remainingIssues),
    "",
    "## Artifacts",
    bulletList(artifactLines(args)),
    "",
    "## Limitations",
    bulletList(limitations),
    previousFeedback.length ? "" : null,
    previousFeedback.length ? "## Final Report Review Feedback Addressed" : null,
    previousFeedback.length ? bulletList(previousFeedback) : null,
  ].filter((line): line is string => line !== null).join("\n");

  return {
    status,
    artifactDirectory: args.plan.outputDir,
    summary,
    beforeAfterSummary: beforeAfter,
    implementedChanges,
    remainingIssues,
    verificationSummary,
    limitations,
    markdown,
  };
}

export async function buildAndWriteFinalReportDraft(args: FinalReportDraftArgs): Promise<FinalReport> {
  const draft = buildFinalReportDraft(args);
  return writeReviewedFinalReport(args.plan, draft);
}

export async function writeReviewedFinalReport(
  plan: TargetPlan,
  draft: FinalReportDraft,
  review?: FinalReportReview,
): Promise<FinalReport> {
  await mkdir(plan.outputDir, { recursive: true });
  const reportPath = join(plan.outputDir, "final-report.md");
  const useReviewerMarkdown = review?.approved === false && review.improvedMarkdown?.trim();
  const markdown = useReviewerMarkdown ? review.improvedMarkdown!.trim() : draft.markdown;
  await writeFile(reportPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");

  return {
    status: draft.status,
    reportPath,
    artifactDirectory: draft.artifactDirectory,
    summary: review?.approved === false
      ? `${draft.summary} Final report review still requested changes: ${review.requiredChanges.join("; ")}`
      : draft.summary,
    beforeAfterSummary: draft.beforeAfterSummary,
    implementedChanges: draft.implementedChanges,
    remainingIssues: draft.remainingIssues,
    verificationSummary: draft.verificationSummary,
    limitations: [
      ...draft.limitations,
      review?.approved === false ? "Final report reviewer did not approve the latest draft within the iteration limit." : "",
    ].filter(Boolean),
    markdown,
  };
}

export async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
