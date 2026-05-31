import { createHash } from "node:crypto";
import type {
  AuditReport,
  CommentPlan,
  Finding,
  PreparedInlineComment,
  PrMetadata,
  PullRequestFile,
  UnanchoredFinding,
  WorkflowInput,
} from "./schemas";
import { renderInlineCommentBody, renderSummaryComment } from "./format";

type AnchorFile = {
  filename: string;
  rightLines: Set<number>;
};

export const markerPrefix = "smithers-bug-regression-audit-pr";
export const summaryMarker = `<!-- ${markerPrefix}:summary -->`;

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export const parsePatchRightLines = (patch: string | null): Set<number> => {
  const lines = new Set<number>();
  if (!patch) return lines;

  let rightLine = 0;
  for (const rawLine of patch.split("\n")) {
    const hunk = hunkHeaderPattern.exec(rawLine);
    if (hunk) {
      rightLine = Number.parseInt(hunk[2]!, 10);
      continue;
    }
    if (!rawLine || rightLine <= 0 || rawLine.startsWith("\\ No newline")) {
      continue;
    }
    const prefix = rawLine[0];
    if (prefix === "+" || prefix === " ") {
      lines.add(rightLine);
      rightLine += 1;
      continue;
    }
    if (prefix === "-") {
      continue;
    }
  }

  return lines;
};

export const buildAnchorIndex = (files: PullRequestFile[]) => {
  const index = new Map<string, AnchorFile>();
  for (const file of files) {
    const anchorFile = {
      filename: file.filename,
      rightLines: parsePatchRightLines(file.patch),
    };
    index.set(file.filename, anchorFile);
    if (file.previousFilename) {
      index.set(file.previousFilename, anchorFile);
    }
  }
  return index;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export const computeDedupeKey = (
  pr: PrMetadata,
  finding: Finding,
  path: string,
  line: number,
  bodyWithoutMarker: string,
) =>
  hash(
    JSON.stringify({
      pr: pr.number,
      headSha: pr.headSha,
      finding: finding.id || finding.title,
      title: finding.title,
      path,
      line,
      bodyHash: hash(bodyWithoutMarker),
    }),
  );

const affectedLineText = (finding: Finding) =>
  finding.affectedFiles
    .map((file) => `${file.path}${file.line ? `:${file.line}` : ""}${file.symbol ? ` (${file.symbol})` : ""}`)
    .join(", ");

export const buildCommentPlan = (
  input: WorkflowInput,
  pr: PrMetadata,
  audit: AuditReport,
  files: PullRequestFile[],
): CommentPlan => {
  const anchorIndex = buildAnchorIndex(files);
  const inlineComments: PreparedInlineComment[] = [];
  const unanchoredFindings: UnanchoredFinding[] = [];
  const limitations: string[] = [];

  for (const finding of audit.findings.slice(0, input.maxFindings)) {
    let anchored: PreparedInlineComment | null = null;
    for (const affectedFile of finding.affectedFiles) {
      if (!affectedFile.line) continue;
      const anchorFile = anchorIndex.get(affectedFile.path);
      if (!anchorFile || !anchorFile.rightLines.has(affectedFile.line)) continue;

      const bodyWithoutMarker = renderInlineCommentBody(finding, affectedLineText(finding));
      const dedupeKey = computeDedupeKey(pr, finding, anchorFile.filename, affectedFile.line, bodyWithoutMarker);
      anchored = {
        findingId: finding.id,
        title: finding.title,
        severity: finding.severity,
        confidence: finding.confidence,
        path: anchorFile.filename,
        line: affectedFile.line,
        side: "RIGHT",
        body: `${bodyWithoutMarker}\n\n<!-- ${markerPrefix}:${dedupeKey} -->`,
        dedupeKey,
      };
      break;
    }

    if (anchored) {
      inlineComments.push(anchored);
    } else {
      unanchoredFindings.push({
        findingId: finding.id,
        title: finding.title,
        reason: "No affected file and line matched a RIGHT-side line in the PR diff.",
        affectedFiles: finding.affectedFiles,
      });
    }
  }

  if (files.some((file) => !file.patch)) {
    limitations.push("Some PR files have no patch payload from GitHub, so findings in those files cannot be anchored inline.");
  }

  return {
    inlineComments,
    summaryComment: renderSummaryComment(pr, audit, inlineComments, unanchoredFindings),
    unanchoredFindings,
    filesConsidered: files,
    limitations,
  };
};

export const extractSmithersMarkers = (bodies: Array<{ body?: string }>) => {
  const markers = new Set<string>();
  const pattern = /<!--\s*smithers-bug-regression-audit-pr:([^>]+?)\s*-->/g;
  for (const item of bodies) {
    if (!item.body) continue;
    for (const match of item.body.matchAll(pattern)) {
      if (match[1]) markers.add(match[1].trim());
    }
  }
  return markers;
};
