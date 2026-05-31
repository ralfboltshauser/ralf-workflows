import { CodexAgent as SmithersCodexAgent } from "smithers-orchestrator";
import { CodexAgent } from "../../agents";

const disabledTools = [...new Set([...(CodexAgent.opts.disable ?? []), "web_search"])];

// The Smithers trace collector currently treats Codex JSONL's final
// unterminated line as a truncated stream. This subclass keeps Codex execution
// behavior while making trace capture fall back to text mode for this workflow.
class AuditCliAgent extends SmithersCodexAgent {}

const auditSystemPrompt = `
You are a senior software engineer auditing a local code change for accidental regressions.
Work from repository evidence only. Do not browse the web. Prefer concrete file evidence over speculation.
Return only structured data that matches the requested schema.
`;

const hunterSystemPrompt = `
You are a specialist regression bug hunter. Your job is to find plausible new bugs introduced by the diff.
Only report a finding when you can connect the changed code to concrete behavior, a contract, or a missing test.
`;

const skepticSystemPrompt = `
You are the skeptical validation reviewer for a regression audit.
Try to disprove each proposed finding. Downgrade or discard anything that lacks evidence, is pre-existing, or is only style preference.
`;

const moderatorSystemPrompt = `
You moderate independent regression reviews. Merge duplicates, preserve evidence, and keep false positives out of the final report.
`;

const withSystemPrompt = (systemPrompt: string, cwd = process.cwd(), id = "bug-audit-agent") =>
  new AuditCliAgent({
    ...CodexAgent.opts,
    id,
    cwd,
    disable: disabledTools,
    systemPrompt: [CodexAgent.opts.systemPrompt, systemPrompt].filter(Boolean).join("\n\n"),
  });

export const createBugAuditAgents = (cwd: string) => ({
  BugAuditAgent: withSystemPrompt(auditSystemPrompt, cwd, "bug-audit-reviewer"),
  BugHunterAgent: withSystemPrompt(hunterSystemPrompt, cwd, "bug-audit-hunter"),
  BugSkepticAgent: withSystemPrompt(skepticSystemPrompt, cwd, "bug-audit-skeptic"),
  BugModeratorAgent: withSystemPrompt(moderatorSystemPrompt, cwd, "bug-audit-moderator"),
});

export const BugAuditAgent = withSystemPrompt(auditSystemPrompt);
export const BugHunterAgent = withSystemPrompt(hunterSystemPrompt);
export const BugSkepticAgent = withSystemPrompt(skepticSystemPrompt);
export const BugModeratorAgent = withSystemPrompt(moderatorSystemPrompt);
