// smithers-source: generated
import { type AgentLike } from "smithers-orchestrator";
import { CodexAgent } from "./agents/codex";

export { CodexAgent } from "./agents/codex";

export const providers = {
  codex: CodexAgent,
} as const;

export const agents = {
  cheapFast: [providers.codex],
  smart: [providers.codex],
  smartTool: [providers.codex],
} as const satisfies Record<string, AgentLike[]>;
