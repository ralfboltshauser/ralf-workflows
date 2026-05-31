import { extractSmithersMarkers, summaryMarker } from "./anchors";
import { renderInlineFallbackSection } from "./format";
import {
  createIssueComment,
  createPullRequestReview,
  fetchExistingCommentBodies,
  updateIssueComment,
} from "./github";
import type { AuditReport, CommentPlan, PrMetadata, PublishResult, WorkflowInput } from "./schemas";

const shouldPostSummary = (input: WorkflowInput, audit: AuditReport) =>
  audit.findings.length > 0 || Boolean(input.postNoFindingsSummary);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const publishOrPrepare = async (
  input: WorkflowInput,
  pr: PrMetadata,
  audit: AuditReport,
  plan: CommentPlan,
): Promise<PublishResult> => {
  const publishMode = input.publishMode ?? "dry-run";
  if (publishMode === "dry-run") {
    return {
      mode: "dry-run",
      failed: false,
      published: null,
      limitations: ["Dry-run mode selected; no GitHub comments were posted."],
    };
  }

  if (!shouldPostSummary(input, audit) && plan.inlineComments.length === 0) {
    return {
      mode: publishMode,
      failed: false,
      published: null,
      limitations: ["No findings were posted because the audit found no bugs and postNoFindingsSummary is false."],
    };
  }

  const existingComments = input.dedupe ? await fetchExistingCommentBodies(pr) : [];
  const existingMarkers = input.dedupe ? extractSmithersMarkers(existingComments) : new Set<string>();
  const commentsToPost = input.dedupe
    ? plan.inlineComments.filter((comment) => !existingMarkers.has(comment.dedupeKey))
    : plan.inlineComments;
  const skippedDuplicateCount = plan.inlineComments.length - commentsToPost.length;

  if (publishMode === "summary-comment") {
    const existingSummary = input.dedupe
      ? existingComments.find((comment) => typeof comment.id === "number" && comment.body?.includes(summaryMarker))
      : undefined;
    const posted = existingSummary
      ? await updateIssueComment(pr.owner, pr.repo, existingSummary.id!, plan.summaryComment)
      : await createIssueComment(pr, plan.summaryComment);

    return {
      mode: publishMode,
      failed: false,
      published: {
        summaryCommentUrl: posted.html_url,
        skippedDuplicateCount,
      },
      limitations: commentsToPost.length > 0 ? ["Summary-comment mode selected; inline comments were not posted."] : [],
    };
  }

  const shouldCreateReview = commentsToPost.length > 0 || shouldPostSummary(input, audit);
  if (!shouldCreateReview) {
    return {
      mode: publishMode,
      failed: false,
      published: { skippedDuplicateCount },
      limitations: ["No non-duplicate inline comments or summary content were available to publish."],
    };
  }

  let posted: { html_url?: string };
  const reviewComments = commentsToPost.map((comment) => ({
    path: comment.path,
    line: comment.line,
    side: comment.side,
    body: comment.body,
  }));
  const limitations: string[] = [];

  try {
    posted = await createPullRequestReview(pr, plan.summaryComment, reviewComments);
  } catch (error) {
    if (reviewComments.length === 0) throw error;
    limitations.push(
      `GitHub rejected inline review comments, so findings were moved into the review summary: ${errorMessage(error)}`,
    );
    try {
      posted = await createPullRequestReview(
        pr,
        `${plan.summaryComment}${renderInlineFallbackSection(commentsToPost)}`,
        [],
      );
    } catch {
      const summary = await createIssueComment(
        pr,
        `${plan.summaryComment}${renderInlineFallbackSection(commentsToPost)}`,
      );
      return {
        mode: publishMode,
        failed: false,
        published: {
          summaryCommentUrl: summary.html_url,
          skippedDuplicateCount,
        },
        limitations: [...limitations, "Could not create a PR review fallback; created an issue summary comment instead."],
      };
    }
  }

  return {
    mode: publishMode,
    failed: false,
    published: {
      reviewUrl: posted.html_url,
      skippedDuplicateCount,
    },
    limitations: [
      ...limitations,
      ...(skippedDuplicateCount > 0 ? [`Skipped ${skippedDuplicateCount} duplicate inline comments.`] : []),
    ],
  };
};
