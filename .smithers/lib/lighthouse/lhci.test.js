import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  buildLhciConfig,
  buildFinalReportDraft,
  compareLighthouseSummaries,
  coerceLighthouseInput,
  createTargetPlan,
  determineApprovalPolicy,
  evaluatePlanGate,
  expandTargetUrls,
  normalizeRoute,
  summarizeLighthouseRuns,
} from "./lhci.ts";

function input(overrides = {}) {
  return {
    repoPath: ".",
    localUrl: "http://localhost:3000",
    allowProdCheck: false,
    routes: ["/"],
    numberOfRuns: 1,
    formFactors: ["mobile"],
    categories: ["performance", "accessibility", "best-practices", "seo"],
    allowImplementation: true,
    approvalMode: "auto",
    maxPlanReviewIterations: 2,
    maxImplementationReviewIterations: 2,
    maxOptimizationIterations: 3,
    thresholds: {
      performance: 0.9,
      accessibility: 0.95,
      bestPractices: 0.95,
      seo: 0.95,
    },
    outputDir: ".smithers/lighthouse-reports",
    ...overrides,
  };
}

describe("lighthouse helpers", () => {
  test("normalizes routes and expands URLs", () => {
    expect(normalizeRoute("dashboard")).toBe("/dashboard");
    expect(normalizeRoute("https://example.com/x")).toBe("https://example.com/x");
    expect(expandTargetUrls("http://localhost:3000/app", ["/", "pricing"])).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/pricing",
    ]);
  });

  test("creates target plan with prod skipped unless authorized", () => {
    const plan = createTargetPlan(input({ prodUrl: "https://example.com" }));
    expect(plan.local.enabled).toBe(true);
    expect(plan.local.mode).toBe("url");
    expect(plan.prod.enabled).toBe(false);
    expect(plan.prod.notes[0]).toContain("allowProdCheck is false");
  });

  test("coerces Smithers snake-case input rows", () => {
    const coerced = coerceLighthouseInput({
      repo_path: "/tmp/app",
      routes: "[\"/\",\"/pricing\"]",
      form_factors: "[\"mobile\"]",
      categories: "[\"performance\",\"seo\"]",
      allow_implementation: 0,
      thresholds: "{\"performance\":0.5,\"accessibility\":0.9,\"bestPractices\":0.9,\"seo\":0.8}",
    });

    expect(coerced.repoPath).toBe("/tmp/app");
    expect(coerced.routes).toEqual(["/", "/pricing"]);
    expect(coerced.allowImplementation).toBe(false);
    expect(coerced.thresholds.performance).toBe(0.5);
  });

  test("generates LHCI config with thresholds and categories", () => {
    const plan = createTargetPlan(input({ localServeCommand: "npm run start" }));
    const config = buildLhciConfig(plan, "local", "baseline", "mobile", "/tmp/out");
    expect(config.ci.collect.startServerCommand).toContain("npm run start");
    expect(config.ci.collect.settings.onlyCategories).toContain("performance");
    expect(config.ci.assert.assertions["categories:performance"][1].minScore).toBe(0.9);
  });

  test("parses Lighthouse report fixture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lhci-fixture-"));
    try {
      await mkdir(join(dir, "reports"), { recursive: true });
      const reportPath = join(dir, "reports", "sample.report.json");
      await writeFile(reportPath, JSON.stringify({
        lighthouseVersion: "12.0.0",
        requestedUrl: "http://localhost:3000/",
        finalUrl: "http://localhost:3000/",
        fetchTime: "2026-01-01T00:00:00.000Z",
        configSettings: { formFactor: "mobile" },
        categories: {
          performance: { score: 0.82 },
          accessibility: { score: 1 },
          "best-practices": { score: 0.96 },
          seo: { score: 0.91 },
        },
        audits: {
          "first-contentful-paint": { title: "FCP", score: 0.9, numericValue: 1000 },
          "largest-contentful-paint": { title: "LCP", score: 0.5, numericValue: 3000 },
          "cumulative-layout-shift": { title: "CLS", score: 1, numericValue: 0 },
          "total-blocking-time": { title: "TBT", score: 0.8, numericValue: 150 },
          "speed-index": { title: "Speed Index", score: 0.8, numericValue: 2200 },
          "render-blocking-resources": {
            title: "Eliminate render-blocking resources",
            score: 0.4,
            numericValue: 200,
            details: { overallSavingsMs: 350 },
          },
        },
        runWarnings: ["fixture warning"],
      }), "utf8");

      const summary = await summarizeLighthouseRuns("local", "baseline", [{
        target: "local",
        phase: "baseline",
        status: "ran",
        configPaths: [],
        artifactDirectories: [dir],
        scratchDirectories: [],
        manifestPaths: [],
        reportFiles: [reportPath],
        commands: [],
        notes: [],
      }]);

      expect(summary.status).toBe("parsed");
      expect(summary.categoryScores.performance).toBe(0.82);
      expect(summary.topOpportunities[0].id).toBe("render-blocking-resources");
      expect(summary.warnings).toContain("fixture warning");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("compares summaries and approval policy", () => {
    const plan = createTargetPlan(input());
    const baseline = {
      target: "local",
      phase: "baseline",
      status: "parsed",
      representativeReportPath: "before.json",
      representativeUrl: "http://localhost:3000/",
      categoryScores: { performance: 0.8, accessibility: 0.9, "best-practices": 0.9, seo: 0.9 },
      metrics: { lcp: 3000 },
      pages: [],
      topOpportunities: [],
      failedAudits: [{ id: "lcp", title: "LCP", score: 0.5, displayValue: "", numericValue: 3000, savingsMs: null, description: "" }],
      diagnostics: [],
      runtimeErrors: [],
      warnings: [],
      artifactDirectories: [],
      notes: [],
    };
    const after = {
      ...baseline,
      phase: "after",
      representativeReportPath: "after.json",
      categoryScores: { performance: 0.93, accessibility: 0.98, "best-practices": 0.98, seo: 0.98 },
      metrics: { lcp: 1800 },
      failedAudits: [],
    };

    const comparison = compareLighthouseSummaries(plan, baseline, after);
    expect(comparison.greatEnough).toBe(true);
    expect(comparison.categoryDeltas.performance).toBe(0.13);

    const policy = determineApprovalPolicy(plan, {
      summary: "plan",
      riskLevel: "high",
      requiresHumanApproval: true,
      workItems: [],
      outOfScope: [],
      approvalRationale: "high risk",
    }, {
      approved: true,
      iterationNeeded: false,
      criticalityApproved: true,
      codebaseFitApproved: true,
      requiredChanges: [],
      summary: "approved",
    });
    expect(policy.requiresHumanApproval).toBe(true);
  });

  test("plan gate feeds approved-but-iteration-needed reviews back into planning", () => {
    const gate = evaluatePlanGate({
      approved: true,
      iterationNeeded: true,
      criticalityApproved: true,
      codebaseFitApproved: true,
      requiredChanges: ["Pin the exact metadata values before implementation."],
      summary: "Approved direction, needs one more draft.",
    }, {
      requiresHumanApproval: false,
      reason: "low risk",
    });

    expect(gate.ready).toBe(false);
    expect(gate.feedbackForNextPlan).toContain("Pin the exact metadata values before implementation.");
  });

  test("builds a useful final report draft from structured workflow outputs", () => {
    const plan = createTargetPlan(input({ allowImplementation: false }));
    const baseline = {
      target: "local",
      phase: "baseline",
      status: "parsed",
      representativeReportPath: "/tmp/lhci/before.json",
      representativeUrl: "http://localhost:3000/",
      categoryScores: { performance: 1, accessibility: 0.84, "best-practices": 0.96, seo: 1 },
      metrics: { fcp: 620, lcp: 766, cls: 0, tbt: 0, speedIndex: 620, ttfb: 12 },
      pages: [],
      topOpportunities: [],
      failedAudits: [
        {
          id: "html-has-lang",
          title: "`<html>` element does not have a `[lang]` attribute",
          score: 0,
          displayValue: "",
          numericValue: null,
          savingsMs: null,
          description: "If a page doesn't specify a lang attribute, screen readers assume the default language.",
        },
      ],
      diagnostics: [],
      runtimeErrors: [],
      warnings: [],
      artifactDirectories: ["/tmp/lhci"],
      notes: [],
    };
    const draft = buildFinalReportDraft({
      plan,
      baseline,
      codebaseReview: {
        summary: "Static HTML app with missing document metadata.",
        framework: "static-html",
        packageManager: "none",
        importantFiles: ["/tmp/app/index.html"],
        likelyRootCauses: [{
          issue: "Missing html lang",
          evidence: "The audited page uses a plain html tag.",
          files: ["/tmp/app/index.html"],
          suggestedDirection: "Set the expected locale on the root html element.",
        }],
        verificationCommands: [],
        constraints: [],
        missingContext: [],
      },
      remediationPlan: {
        summary: "Fix document language metadata.",
        riskLevel: "low",
        requiresHumanApproval: false,
        workItems: [{
          priority: "p0",
          title: "Add html lang",
          lighthouseEvidence: "html-has-lang failed.",
          codebaseEvidence: "index.html lacks lang.",
          filesExpectedToChange: ["/tmp/app/index.html"],
          implementationApproach: "Add lang=\"en\" or the product locale.",
          verification: ["rerun Lighthouse"],
          requiresApproval: false,
        }],
        outOfScope: [],
        approvalRationale: "Low-risk metadata change.",
      },
    });

    expect(draft.markdown).toContain("## Score Summary");
    expect(draft.markdown).toContain("## Key Metrics");
    expect(draft.markdown).toContain("html-has-lang");
    expect(draft.markdown).toContain("## Codebase Review");
    expect(draft.markdown).toContain("## Remediation Plan");
    expect(draft.markdown).toContain("/tmp/lhci/before.json");
  });
});
