import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const run = async (cmd: string, args: string[], cwd: string) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30 * 60_000,
  });
  return { stdout, stderr };
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const smithersDir = path.resolve(scriptDir, "..");
const packRoot = path.resolve(smithersDir, "..");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "smithers-bug-audit-fixture-"));
const repoPath = path.join(fixtureRoot, "external-repo");
const runId = `bug-regression-audit-external-smoke-${Date.now()}`;
const outputDir = path.join(smithersDir, "bug-regression-audit-reports", runId);
const startedAt = Date.now();

try {
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await run("git", ["init", "-b", "main"], repoPath);
  await run("git", ["config", "user.email", "smithers-smoke@example.invalid"], repoPath);
  await run("git", ["config", "user.name", "Smithers Smoke"], repoPath);
  await writeFile(
    path.join(repoPath, "src", "cache.js"),
    [
      "export function readUser(cache, userId) {",
      "  return cache.get(userId) ?? null;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await run("git", ["add", "."], repoPath);
  await run("git", ["commit", "-m", "baseline"], repoPath);
  await writeFile(
    path.join(repoPath, "src", "cache.js"),
    [
      "export function readUser(cache, userId) {",
      "  return cache.get(\"current\") ?? null;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const input = {
    repoPath,
    baseRef: "HEAD",
    headRef: "HEAD",
    includeUncommitted: true,
    auditMode: "quick",
    maxFindings: 3,
    outputDir,
    checkCommands: ["node --check src/cache.js"],
  };

  const result = await run(
    "bunx",
    ["smithers-orchestrator", "workflow", "run", "bug-regression-audit", "--run-id", runId, "--input", JSON.stringify(input)],
    packRoot,
  );
  const finalOutput = await run(
    "bunx",
    ["smithers-orchestrator", "output", runId, "final-output", "--json"],
    packRoot,
  );
  const reportPath = path.join(outputDir, "bug-regression-audit.md");
  await readFile(reportPath, "utf8");
  const combinedRunOutput = `${result.stdout}\n${result.stderr}`;
  const finalOutputReadable = finalOutput.stdout.includes("\"verdict\"");
  const stderrHadTraceCaptureErrors = /truncated-json-stream|capture-failed/.test(result.stderr);

  if (!finalOutputReadable) {
    throw new Error(`final-output was not readable for ${runId}`);
  }
  if (stderrHadTraceCaptureErrors) {
    throw new Error(`trace capture emitted truncation errors for ${runId}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        repoPath,
        reportPath,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        workflowRunPrintedFinalOutput: /output(?:\[\d+\])?:/.test(combinedRunOutput),
        finalOutputReadable,
        stderrHadTraceCaptureErrors,
      },
      null,
      2,
    ),
  );
} finally {
  if (!process.env.SMITHERS_KEEP_BUG_AUDIT_SMOKE_REPO) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
