import type {
  DiffBundle,
  DiffFileBundle,
  DiffIntake,
  EffectiveAuditConfig,
  SkippedDiffFile,
} from "./schemas";

type ChangedFile = DiffIntake["changedFiles"][number];

type FilePatchBlock = {
  path: string;
  oldPath: string | null;
  binary: boolean;
  hunks: DiffFileBundle["hunks"];
};

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s?(.*)$/;

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.?\//, "");

const trimGitPathPrefix = (value: string) =>
  value === "/dev/null" ? value : value.replace(/^a\//, "").replace(/^b\//, "");

const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

const globToRegExp = (pattern: string) => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};

const matchesGlob = (filePath: string, pattern: string) => {
  const normalizedPath = normalizePath(filePath);
  const normalizedPattern = normalizePath(pattern);
  const patterns = normalizedPattern.startsWith("**/")
    ? [normalizedPattern, normalizedPattern.slice(3)]
    : [normalizedPattern];
  return patterns.some((candidate) => globToRegExp(candidate).test(normalizedPath));
};

const matchesRegex = (filePath: string, pattern: string) => {
  try {
    return new RegExp(pattern).test(filePath);
  } catch {
    return false;
  }
};

export const isGeneratedPath = (filePath: string, config: EffectiveAuditConfig) =>
  config.generatedGlobs.some((pattern) => matchesGlob(filePath, pattern));

const skipReasonForFile = (
  file: ChangedFile,
  patch: FilePatchBlock | undefined,
  config: EffectiveAuditConfig,
) => {
  if (config.ignoreGlobs.some((pattern) => matchesGlob(file.path, pattern))) return "ignored by ignoreGlobs";
  if (config.ignoreRegexes.some((pattern) => matchesRegex(file.path, pattern))) return "ignored by ignoreRegexes";
  if (!config.includeGenerated && isGeneratedPath(file.path, config)) return "generated or low-signal file";
  if (patch?.binary) return "binary or non-text patch";
  if (!patch || patch.hunks.length === 0) return "no text patch available";
  return "";
};

const addSideLines = (hunk: DiffFileBundle["hunks"][number]) => {
  hunk.oldSideLines = hunk.lines
    .filter((line) => line.oldLine != null)
    .map((line) => ({ line: line.oldLine!, kind: line.kind, text: line.text }));
  hunk.newSideLines = hunk.lines
    .filter((line) => line.newLine != null)
    .map((line) => ({ line: line.newLine!, kind: line.kind, text: line.text }));
};

export const parseUnifiedDiff = (patch: string): Map<string, FilePatchBlock> => {
  const blocks = new Map<string, FilePatchBlock>();
  const lines = patch.split(/\r?\n/);
  let current: FilePatchBlock | null = null;
  let currentHunk: DiffFileBundle["hunks"][number] | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finishHunk = () => {
    if (currentHunk) {
      addSideLines(currentHunk);
    }
    currentHunk = null;
  };

  const finishFile = () => {
    finishHunk();
    if (current) {
      blocks.set(current.path, current);
      if (current.oldPath && current.oldPath !== current.path) {
        blocks.set(current.oldPath, current);
      }
    }
    current = null;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith("diff --git ")) {
      finishFile();
      const match = /^diff --git (.+?) (.+)$/.exec(rawLine);
      const oldPath = match?.[1] ? trimGitPathPrefix(match[1]) : "";
      const newPath = match?.[2] ? trimGitPathPrefix(match[2]) : oldPath;
      current = {
        path: normalizePath(newPath || oldPath),
        oldPath: oldPath && oldPath !== "/dev/null" ? normalizePath(oldPath) : null,
        binary: false,
        hunks: [],
      };
      continue;
    }

    if (!current) continue;

    if (rawLine.startsWith("Binary files ") || rawLine.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }

    if (rawLine.startsWith("rename from ")) {
      current.oldPath = normalizePath(rawLine.slice("rename from ".length));
      continue;
    }
    if (rawLine.startsWith("rename to ")) {
      current.path = normalizePath(rawLine.slice("rename to ".length));
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      const oldPath = trimGitPathPrefix(rawLine.slice(4).trim());
      if (oldPath !== "/dev/null") current.oldPath = normalizePath(oldPath);
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      const newPath = trimGitPathPrefix(rawLine.slice(4).trim());
      if (newPath !== "/dev/null") current.path = normalizePath(newPath);
      continue;
    }

    const hunk = hunkHeaderPattern.exec(rawLine);
    if (hunk) {
      finishHunk();
      oldLine = Number.parseInt(hunk[1]!, 10);
      newLine = Number.parseInt(hunk[3]!, 10);
      currentHunk = {
        oldStart: oldLine,
        oldLines: hunk[2] ? Number.parseInt(hunk[2], 10) : 1,
        newStart: newLine,
        newLines: hunk[4] ? Number.parseInt(hunk[4], 10) : 1,
        section: hunk[5] ?? "",
        lines: [],
        oldSideLines: [],
        newSideLines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || rawLine.startsWith("\\ No newline")) continue;

    const prefix = rawLine[0];
    const text = rawLine.length > 0 ? rawLine.slice(1) : "";
    if (prefix === " ") {
      currentHunk.lines.push({ kind: "context", oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    } else if (prefix === "+") {
      currentHunk.lines.push({ kind: "added", oldLine: null, newLine, text });
      newLine += 1;
    } else if (prefix === "-") {
      currentHunk.lines.push({ kind: "deleted", oldLine, newLine: null, text });
      oldLine += 1;
    }
  }

  finishFile();
  return blocks;
};

const truncateHunksToBudget = (
  file: DiffFileBundle,
  remainingTokens: number,
): DiffFileBundle | null => {
  if (remainingTokens < 200 || file.hunks.length === 0) return null;
  const next: DiffFileBundle = { ...file, hunks: [], truncated: true, tokenEstimate: 0 };
  for (const hunk of file.hunks) {
    const candidate = { ...next, hunks: [...next.hunks, hunk] };
    const candidateTokens = estimateTokens(candidate);
    if (candidateTokens > remainingTokens && next.hunks.length > 0) break;
    if (candidateTokens > remainingTokens) {
      const trimmed = { ...hunk, lines: hunk.lines.slice(0, Math.max(1, Math.floor(hunk.lines.length / 2))) };
      addSideLines(trimmed);
      next.hunks.push(trimmed);
      break;
    }
    next.hunks.push(hunk);
  }
  if (next.hunks.length === 0) return null;
  next.tokenEstimate = estimateTokens(next);
  return next;
};

export const buildDiffBundle = (
  changedFiles: ChangedFile[],
  rawPatch: string,
  config: EffectiveAuditConfig,
  baseCommit: string,
  headCommit: string,
  effectiveBaseCommit: string,
): { bundle: DiffBundle; changedFiles: ChangedFile[] } => {
  const patchBlocks = parseUnifiedDiff(rawPatch);
  const skippedFiles: SkippedDiffFile[] = [];
  const candidateFiles: DiffFileBundle[] = [];
  const annotatedChangedFiles: ChangedFile[] = [];

  for (const file of changedFiles) {
    const patch = patchBlocks.get(file.path) ?? (file.oldPath ? patchBlocks.get(file.oldPath) : undefined);
    const generated = isGeneratedPath(file.path, config);
    const reason = skipReasonForFile(file, patch, config);
    annotatedChangedFiles.push({
      ...file,
      oldPath: file.oldPath ?? patch?.oldPath ?? null,
      generated,
      skipped: Boolean(reason),
      skipReason: reason || null,
    });

    if (reason) {
      skippedFiles.push({
        path: file.path,
        oldPath: file.oldPath ?? patch?.oldPath ?? null,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        reason,
      });
      continue;
    }

    const bundleFile: DiffFileBundle = {
      path: file.path,
      oldPath: file.oldPath ?? patch?.oldPath ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      generated,
      binary: Boolean(patch?.binary),
      hunks: patch?.hunks ?? [],
      tokenEstimate: 0,
      truncated: false,
    };
    bundleFile.tokenEstimate = estimateTokens(bundleFile);
    candidateFiles.push(bundleFile);
  }

  const files: DiffFileBundle[] = [];
  let estimatedTokens = 0;
  let truncated = false;
  for (const file of candidateFiles) {
    if (estimatedTokens + file.tokenEstimate <= config.maxDiffTokens) {
      files.push(file);
      estimatedTokens += file.tokenEstimate;
      continue;
    }

    const truncatedFile = truncateHunksToBudget(file, config.maxDiffTokens - estimatedTokens);
    if (truncatedFile) {
      files.push(truncatedFile);
      estimatedTokens += truncatedFile.tokenEstimate;
    } else {
      skippedFiles.push({
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        reason: "diff token budget exceeded",
      });
      const changedFile = annotatedChangedFiles.find((item) => item.path === file.path);
      if (changedFile) {
        changedFile.skipped = true;
        changedFile.skipReason = "diff token budget exceeded";
      }
    }
    truncated = true;
  }

  return {
    changedFiles: annotatedChangedFiles,
    bundle: {
      baseCommit,
      headCommit,
      effectiveBaseCommit,
      files,
      skippedFiles,
      budget: {
        requestedTokens: config.maxDiffTokens,
        estimatedTokens,
        truncated,
      },
    },
  };
};
