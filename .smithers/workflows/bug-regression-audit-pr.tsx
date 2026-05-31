// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Bug Regression Audit PR
// smithers-description: Run the bug regression audit workflow against a GitHub PR using an effective merge-base checkout, then prepare or publish PR review comments.
// smithers-tags: bugbot, regression-audit, code-review, github-pr, pr-review
/** @jsxImportSource smithers-orchestrator */
import { Subflow, createSmithers, type SmithersWorkflow } from "smithers-orchestrator";
import bugRegressionAuditWorkflow from "./bug-regression-audit";
import {
  buildAuditSubflowInput,
  buildCommentPlan,
  buildFailedOutput,
  buildFinalOutput,
  bugRegressionAuditPrSchemas,
  fetchPullRequestFiles,
  preparePullRequestCheckout,
  publishOrPrepare,
  resolvePullRequest,
} from "../components/bug-regression-audit-pr";

const { Workflow, Task, Sequence, outputs, smithers } = createSmithers(
  bugRegressionAuditPrSchemas,
  {
    readableName: "Bug Regression Audit PR",
    description: "Run the bug regression audit workflow against a GitHub PR using an effective merge-base checkout, then prepare or publish PR comments.",
  },
);

const auditSubflowWorkflow = bugRegressionAuditWorkflow as unknown as SmithersWorkflow<unknown>;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default smithers((ctx) => {
  const resolution = ctx.outputMaybe(outputs.prResolution, { nodeId: "resolve-pr" });
  const checkout = ctx.outputMaybe(outputs.checkout, { nodeId: "prepare-checkout" });
  const audit = ctx.outputMaybe(outputs.audit, { nodeId: "run-audit" });
  const commentPlan = ctx.outputMaybe(outputs.commentPlan, { nodeId: "map-comments" });
  const publishResult = ctx.outputMaybe(outputs.publishResult, { nodeId: "publish-or-dry-run" });
  const prWithEffectiveBase =
    resolution?.status === "resolved"
      ? { ...resolution.pr, effectiveBaseSha: checkout?.effectiveBaseSha || resolution.pr.effectiveBaseSha }
      : null;

  return (
    <Workflow name="bug-regression-audit-pr">
      <Sequence>
        <Task id="resolve-pr" output={outputs.prResolution} noRetry>
          {() => resolvePullRequest(ctx.input)}
        </Task>

        {resolution?.status === "failed" ? (
          <Task id="final-output" output={outputs.output} noRetry>
            {() => buildFailedOutput(ctx.input, resolution, resolution.summary, resolution.limitations)}
          </Task>
        ) : null}

        {resolution?.status === "resolved" ? (
          <Task id="prepare-checkout" output={outputs.checkout} noRetry>
            {() => preparePullRequestCheckout(ctx.input, resolution.pr)}
          </Task>
        ) : null}

        {resolution?.status === "resolved" && checkout?.status === "failed" ? (
          <Task id="final-output" output={outputs.output} noRetry>
            {() => buildFailedOutput(ctx.input, resolution, checkout.summary, checkout.limitations)}
          </Task>
        ) : null}

        {resolution?.status === "resolved" && checkout?.status === "ready" ? (
          <Subflow
            id="run-audit"
            workflow={auditSubflowWorkflow}
            input={buildAuditSubflowInput(ctx.input, checkout, resolution.pr)}
            output={outputs.audit}
            mode="childRun"
            retries={1}
          />
        ) : null}

        {resolution?.status === "resolved" && audit ? (
          <Task id="map-comments" output={outputs.commentPlan} noRetry>
            {async () => {
              try {
                const files = await fetchPullRequestFiles(resolution.pr);
                return buildCommentPlan(ctx.input, prWithEffectiveBase ?? resolution.pr, audit, files);
              } catch (error) {
                return {
                  ...buildCommentPlan(ctx.input, prWithEffectiveBase ?? resolution.pr, audit, []),
                  limitations: [`Could not fetch or parse PR changed files: ${errorMessage(error)}`],
                };
              }
            }}
          </Task>
        ) : null}

        {resolution?.status === "resolved" && audit && commentPlan ? (
          <Task id="publish-or-dry-run" output={outputs.publishResult} noRetry>
            {async () => {
              try {
                return await publishOrPrepare(ctx.input, prWithEffectiveBase ?? resolution.pr, audit, commentPlan);
              } catch (error) {
                return {
                  mode: ctx.input.publishMode ?? "dry-run",
                  failed: true,
                  published: null,
                  limitations: [`Could not publish PR comments: ${errorMessage(error)}`],
                };
              }
            }}
          </Task>
        ) : null}

        {resolution?.status === "resolved" && audit && commentPlan && publishResult ? (
          <Task id="final-output" output={outputs.output} noRetry>
            {() =>
              buildFinalOutput(ctx.input, prWithEffectiveBase ?? resolution.pr, audit, commentPlan, publishResult, [
                ...(checkout?.limitations ?? []),
                ...resolution.limitations,
              ])
            }
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
