import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditConfigSchema, type EffectiveAuditConfig, type WorkflowInput } from "./schemas";

const defaultConfigPath = ".smithers/bug-regression-audit.config.json";

const defaultGeneratedGlobs = [
  "**/*.lock",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/build/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/*.pb.ts",
  "**/*.pb.go",
];

const defaultDiffTokenBudget = {
  quick: 12_000,
  standard: 40_000,
  deep: 90_000,
} as const;

const defaultContextLines = {
  quick: 6,
  standard: 20,
  deep: 80,
} as const;

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const resolveConfigPath = (repoRoot: string, configPath: string | undefined) => {
  const requested = configPath?.trim() || defaultConfigPath;
  return path.isAbsolute(requested) ? requested : path.resolve(repoRoot, requested);
};

export const loadEffectiveAuditConfig = async (
  input: WorkflowInput,
  repoRoot: string,
): Promise<EffectiveAuditConfig> => {
  const limitations: string[] = [];
  const resolvedConfigPath = resolveConfigPath(repoRoot, input.configPath);
  let configLoaded = false;
  let fileConfig = auditConfigSchema.parse({});

  try {
    const raw = await readFile(resolvedConfigPath, "utf8");
    fileConfig = auditConfigSchema.parse(JSON.parse(raw));
    configLoaded = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (input.configPath || code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      limitations.push(`Could not load audit config at ${resolvedConfigPath}: ${message}`);
    }
  }

  const auditMode =
    input.auditMode === "quick" || input.auditMode === "standard" || input.auditMode === "deep"
      ? input.auditMode
      : fileConfig.defaultAuditMode ?? "standard";

  return {
    configPath: resolvedConfigPath,
    configLoaded,
    ignoreGlobs: unique([...(fileConfig.ignoreGlobs ?? []), ...(input.ignoreGlobs ?? [])]),
    ignoreRegexes: unique([...(fileConfig.ignoreRegexes ?? []), ...(input.ignoreRegexes ?? [])]),
    generatedGlobs: unique([...defaultGeneratedGlobs, ...(fileConfig.generatedGlobs ?? [])]),
    projectRules: unique(fileConfig.projectRules ?? []),
    auditMode,
    includeGenerated: Boolean(input.includeGenerated),
    maxDiffTokens: input.maxDiffTokens ?? defaultDiffTokenBudget[auditMode],
    contextLines: input.contextLines ?? defaultContextLines[auditMode],
    minConfidence: input.minConfidence ?? fileConfig.minConfidence ?? "low",
    limitations,
  };
};
