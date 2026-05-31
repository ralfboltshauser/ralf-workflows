import type { categories } from "./schemas";

export type BugCategory = (typeof categories)[number];

export type HunterDefinition = {
  id: string;
  category: BugCategory;
  title: string;
  focus: string;
};

export const hunterDefinitions: HunterDefinition[] = [
  {
    id: "correctness",
    category: "correctness",
    title: "Correctness Hunter",
    focus:
      "Look for logic regressions, edge cases, inverted conditions, off-by-one errors, changed defaults, null handling, and behavior that no longer matches nearby code.",
  },
  {
    id: "api-contract",
    category: "api-contract",
    title: "API Contract Hunter",
    focus:
      "Look for schema, type, route, serialization, backwards-compatibility, error-shape, and external contract regressions.",
  },
  {
    id: "state-data",
    category: "state-data",
    title: "State And Data Hunter",
    focus:
      "Look for persistence, migration, caching, idempotency, transaction, data-loss, stale-read, and state-transition bugs.",
  },
  {
    id: "async-concurrency",
    category: "async-concurrency",
    title: "Async And Concurrency Hunter",
    focus:
      "Look for races, ordering bugs, missing awaits, retry hazards, cancellation issues, timeout behavior, and non-idempotent async paths.",
  },
  {
    id: "security-permissions",
    category: "security-permissions",
    title: "Security And Permission Hunter",
    focus:
      "Look for accidental authorization, authentication, tenant isolation, validation, secret-handling, and privilege-boundary regressions.",
  },
  {
    id: "test-gap",
    category: "test-gap",
    title: "Test Gap Hunter",
    focus:
      "Look for changed behavior without focused regression coverage. Produce coverage gaps and suggested tests, not speculative bugs.",
  },
];

export const contextSourceNames = ["callers", "tests", "contracts", "runtime"] as const;
