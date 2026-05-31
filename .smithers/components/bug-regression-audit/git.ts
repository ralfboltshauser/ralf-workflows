import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CheckEvidence, DiffIntake, WorkflowInput } from "./schemas";

const execAsync = promisify(execCallback);
const execFileAsync = promisify(execFileCallback);
const maxDiffChars = 120_000;
const maxCommandOutputChars = 4_000;

type GitResult = {
  stdout: string;
  stderr: string;
  code: number;
};

const excerpt = (value: string, limit = maxCommandOutputChars) =>
  value.length > limit ? `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]` : value;

const commandError = (error: unknown): GitResult => {
  const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
  return {
    stdout: err.stdout ?? "",
    stderr: err.stderr ?? err.message ?? "",
    code: typeof err.code === "number" ? err.code : 1,
  };
};

const runGit = async (
  repoPath: string,
  args: string[],
  commandsRun: string[],
  allowFailure = false,
): Promise<GitResult> => {
  commandsRun.push(`git ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", repoPath, ...args], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 60_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }
    return commandError(error);
  }
};

const parseNumstat = (numstat: string) => {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const rawAdditions = parts[0] ?? "0";
    const rawDeletions = parts[1] ?? "0";
    const filePath = parts.length > 3 ? parts[parts.length - 1] : parts[2];
    if (!filePath) continue;
    result.set(filePath, {
      additions: rawAdditions === "-" ? 0 : Number.parseInt(rawAdditions, 10) || 0,
      deletions: rawDeletions === "-" ? 0 : Number.parseInt(rawDeletions, 10) || 0,
    });
  }
  return result;
};

const parseNameStatus = (nameStatus: string, numstat: Map<string, { additions: number; deletions: number }>) => {
  const files: DiffIntake["changedFiles"] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    const filePath = parts.length > 2 ? parts[parts.length - 1] : parts[1];
    if (!filePath) continue;
    const counts = numstat.get(filePath) ?? { additions: 0, deletions: 0 };
    files.push({
      path: filePath,
      status,
      additions: counts.additions,
      deletions: counts.deletions,
    });
  }
  return files;
};

const resolveCommit = async (repoRoot: string, ref: string, commandsRun: string[]) => {
  const resolved = await runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], commandsRun, true);
  return resolved.code === 0 ? resolved.stdout.trim() : "";
};

const resolveMergeBase = async (repoRoot: string, baseRef: string, headRef: string, commandsRun: string[]) => {
  const resolved = await runGit(repoRoot, ["merge-base", baseRef, headRef], commandsRun, true);
  return resolved.code === 0 ? resolved.stdout.trim() : "";
};

export const buildDiffIntake = async (input: WorkflowInput): Promise<DiffIntake> => {
  const commandsRun: string[] = [];
  const limitations: string[] = [];
  const requestedRepoPath = typeof input.repoPath === "string" ? input.repoPath : ".";
  const absoluteRepoPath = path.resolve(process.cwd(), requestedRepoPath);
  const requestedHeadRef = typeof input.headRef === "string" ? input.headRef : "HEAD";
  const includeUncommitted = typeof input.includeUncommitted === "boolean" ? input.includeUncommitted : true;

  const rootResult = await runGit(absoluteRepoPath, ["rev-parse", "--show-toplevel"], commandsRun, true);
  if (rootResult.code !== 0) {
    return {
      repoPath: requestedRepoPath,
      repoRoot: absoluteRepoPath,
      currentBranch: "",
      upstreamRef: "",
      requestedBaseRef: input.baseRef ?? "",
      requestedHeadRef,
      resolvedBaseRef: "",
      resolvedBaseCommit: "",
      resolvedHeadRef: requestedHeadRef,
      resolvedHeadCommit: "",
      baseResolution: "failed: repoPath is not a git repository",
      baselineStatus: "inconclusive",
      includeUncommitted,
      hasUncommittedChanges: false,
      untrackedFiles: [],
      changedFiles: [],
      diffSummary: "",
      unifiedDiff: "",
      diffTruncated: false,
      commandsRun,
      limitations: [`Could not resolve a git repository at ${absoluteRepoPath}.`],
    };
  }

  const repoRoot = rootResult.stdout.trim();
  const currentBranch = (await runGit(repoRoot, ["branch", "--show-current"], commandsRun, true)).stdout.trim();
  const upstream = (await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], commandsRun, true))
    .stdout.trim();
  const status = (await runGit(repoRoot, ["status", "--short"], commandsRun, true)).stdout;
  const untrackedFiles = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const hasUncommittedChanges = status.trim().length > 0;
  const resolvedHeadCommit = await resolveCommit(repoRoot, requestedHeadRef, commandsRun);

  if (!resolvedHeadCommit) {
    return {
      repoPath: requestedRepoPath,
      repoRoot,
      currentBranch,
      upstreamRef: upstream,
      requestedBaseRef: input.baseRef ?? "",
      requestedHeadRef,
      resolvedBaseRef: "",
      resolvedBaseCommit: "",
      resolvedHeadRef: requestedHeadRef,
      resolvedHeadCommit: "",
      baseResolution: `failed: could not resolve head ref ${requestedHeadRef}`,
      baselineStatus: "inconclusive",
      includeUncommitted,
      hasUncommittedChanges,
      untrackedFiles,
      changedFiles: [],
      diffSummary: "",
      unifiedDiff: "",
      diffTruncated: false,
      commandsRun,
      limitations: [`Could not resolve head ref ${requestedHeadRef}.`],
    };
  }

  const candidates = input.baseRef ? [input.baseRef] : [upstream, "origin/main", "main"].filter(Boolean);
  let resolvedBaseRef = "";
  let resolvedBaseCommit = "";
  let baseResolution = "";

  for (const candidate of candidates) {
    const candidateCommit = await resolveCommit(repoRoot, candidate, commandsRun);
    if (!candidateCommit) continue;
    if (input.baseRef) {
      resolvedBaseRef = candidate;
      resolvedBaseCommit = candidateCommit;
      baseResolution = `explicit:${candidate}`;
      break;
    }
    const mergeBase = await resolveMergeBase(repoRoot, candidate, requestedHeadRef, commandsRun);
    resolvedBaseRef = candidate;
    resolvedBaseCommit = mergeBase || candidateCommit;
    baseResolution = mergeBase ? `merge-base:${candidate}` : `ref:${candidate}`;
    break;
  }

  if (!resolvedBaseCommit) {
    return {
      repoPath: requestedRepoPath,
      repoRoot,
      currentBranch,
      upstreamRef: upstream,
      requestedBaseRef: input.baseRef ?? "",
      requestedHeadRef,
      resolvedBaseRef: "",
      resolvedBaseCommit: "",
      resolvedHeadRef: requestedHeadRef,
      resolvedHeadCommit,
      baseResolution: "failed: no baseRef, upstream, origin/main, or main could be resolved",
      baselineStatus: "inconclusive",
      includeUncommitted,
      hasUncommittedChanges,
      untrackedFiles,
      changedFiles: [],
      diffSummary: "",
      unifiedDiff: "",
      diffTruncated: false,
      commandsRun,
      limitations: ["Could not resolve a baseline. Provide baseRef to make the audit conclusive."],
    };
  }

  const diffArgs =
    includeUncommitted && requestedHeadRef === "HEAD"
      ? ["diff", "--find-renames", resolvedBaseCommit]
      : ["diff", "--find-renames", resolvedBaseCommit, requestedHeadRef];

  if (includeUncommitted && requestedHeadRef !== "HEAD") {
    limitations.push("includeUncommitted only applies to HEAD-based audits; diff was generated from baseRef to headRef.");
  }
  if (!includeUncommitted && hasUncommittedChanges) {
    limitations.push("Working tree changes are present but excluded because includeUncommitted is false.");
  }
  if (includeUncommitted && untrackedFiles.length > 0) {
    limitations.push("Untracked files are listed but not included in the unified diff.");
  }

  const nameStatus = await runGit(repoRoot, [...diffArgs, "--name-status"], commandsRun, true);
  const numstat = await runGit(repoRoot, [...diffArgs, "--numstat"], commandsRun, true);
  const stat = await runGit(repoRoot, [...diffArgs, "--stat"], commandsRun, true);
  const unified = await runGit(repoRoot, [...diffArgs, "--unified=80"], commandsRun, true);
  const numstatByPath = parseNumstat(numstat.stdout);
  const changedFiles = parseNameStatus(nameStatus.stdout, numstatByPath);

  if (includeUncommitted) {
    for (const untrackedFile of untrackedFiles) {
      if (!changedFiles.some((file) => file.path === untrackedFile)) {
        changedFiles.push({ path: untrackedFile, status: "??", additions: 0, deletions: 0 });
      }
    }
  }

  const rawDiff = unified.stdout;
  const truncated = rawDiff.length > maxDiffChars;

  return {
    repoPath: requestedRepoPath,
    repoRoot,
    currentBranch,
    upstreamRef: upstream,
    requestedBaseRef: input.baseRef ?? "",
    requestedHeadRef,
    resolvedBaseRef,
    resolvedBaseCommit,
    resolvedHeadRef: requestedHeadRef,
    resolvedHeadCommit,
    baseResolution,
    baselineStatus: "resolved",
    includeUncommitted,
    hasUncommittedChanges,
    untrackedFiles,
    changedFiles,
    diffSummary: stat.stdout.trim(),
    unifiedDiff: excerpt(rawDiff, maxDiffChars),
    diffTruncated: truncated,
    commandsRun,
    limitations,
  };
};

export const runValidationChecks = async (input: WorkflowInput, intake: DiffIntake): Promise<CheckEvidence> => {
  const configuredChecks = Array.isArray(input.checkCommands) ? input.checkCommands : [];
  const commands = [...new Set(["git diff --check", ...configuredChecks])];
  const commandsRun: CheckEvidence["commandsRun"] = [];
  const skippedCommands: string[] = [];

  if (!intake.repoRoot) {
    return {
      summary: "No checks were run because the repository root could not be resolved.",
      commandsRun: [],
      skippedCommands: commands,
      limitations: ["Checks require a resolved git repository."],
    };
  }

  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: intake.repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60_000,
      });
      commandsRun.push({
        command,
        purpose: command === "git diff --check" ? "Detect whitespace errors and conflict markers in the diff." : "User supplied validation check.",
        result: "passed",
        exitCode: 0,
        summary: stderr.trim() || stdout.trim() || "Command completed successfully.",
        outputExcerpt: excerpt([stdout, stderr].filter(Boolean).join("\n")),
      });
    } catch (error) {
      const result = commandError(error);
      commandsRun.push({
        command,
        purpose: command === "git diff --check" ? "Detect whitespace errors and conflict markers in the diff." : "User supplied validation check.",
        result: "failed",
        exitCode: result.code,
        summary: result.stderr.trim() || result.stdout.trim() || `Command failed with exit code ${result.code}.`,
        outputExcerpt: excerpt([result.stdout, result.stderr].filter(Boolean).join("\n")),
      });
    }
  }

  return {
    summary:
      commandsRun.length === 0
        ? "No validation checks were run."
        : `${commandsRun.filter((check) => check.result === "passed").length}/${commandsRun.length} validation checks passed.`,
    commandsRun,
    skippedCommands,
    limitations: [],
  };
};
