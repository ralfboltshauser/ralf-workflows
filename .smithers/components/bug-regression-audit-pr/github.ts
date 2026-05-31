import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CheckoutResult,
  PrMetadata,
  PrResolution,
  PullRequestFile,
  WorkflowInput,
} from "./schemas";

const execFileAsync = promisify(execFileCallback);
const maxBuffer = 20 * 1024 * 1024;

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
};

const emptyPr = (input: string): PrMetadata => ({
  owner: "",
  repo: "",
  number: 0,
  url: input,
  title: "",
  baseSha: "",
  headSha: "",
  effectiveBaseSha: "",
  baseRefName: "",
  headRefName: "",
  isDraft: false,
  cloneUrl: "",
});

const errorResult = (error: unknown): CommandResult => {
  const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
  return {
    stdout: err.stdout ?? "",
    stderr: err.stderr ?? err.message ?? "",
    code: typeof err.code === "number" ? err.code : 1,
  };
};

export const runCommand = async (
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; allowFailure?: boolean; timeoutMs?: number } = {},
): Promise<CommandResult> => {
  if (options.input !== undefined) {
    return runCommandWithInput(command, args, options.input, options);
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer,
      timeout: options.timeoutMs ?? 120_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    if (!options.allowFailure) throw error;
    return errorResult(error);
  }
};

const runCommandWithInput = async (
  command: string,
  args: string[],
  input: string,
  options: { cwd?: string; allowFailure?: boolean; timeoutMs?: number },
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 120_000);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!options.allowFailure) {
        reject(error);
        return;
      }
      resolve({ stdout: "", stderr: error.message, code: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 1,
      };
      if (result.code !== 0 && !options.allowFailure) {
        reject(Object.assign(new Error(result.stderr || `Command failed with code ${result.code}`), result));
        return;
      }
      resolve(result);
    });
    child.stdin.end(input);
  });

export const parsePrReference = (input: string) => {
  const trimmed = input.trim();
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(trimmed);
  if (shorthand) {
    return {
      owner: shorthand[1]!,
      repo: shorthand[2]!,
      number: Number.parseInt(shorthand[3]!, 10),
    };
  }

  const url = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(trimmed);
  if (url) {
    return {
      owner: decodeURIComponent(url[1]!),
      repo: decodeURIComponent(url[2]!),
      number: Number.parseInt(url[3]!, 10),
    };
  }

  throw new Error("PR must be a GitHub URL like https://github.com/OWNER/REPO/pull/123 or OWNER/REPO#123.");
};

const pickString = (value: unknown) => (typeof value === "string" ? value : "");

export const resolvePullRequest = async (input: WorkflowInput): Promise<PrResolution> => {
  try {
    const parsed = parsePrReference(input.pr);
    const apiPath = `repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;
    const result = await runCommand("gh", ["api", apiPath], { timeoutMs: 120_000 });
    const raw = JSON.parse(result.stdout) as Record<string, unknown>;
    const base = raw.base && typeof raw.base === "object" ? (raw.base as Record<string, unknown>) : {};
    const head = raw.head && typeof raw.head === "object" ? (raw.head as Record<string, unknown>) : {};
    const baseRepo = base.repo && typeof base.repo === "object" ? (base.repo as Record<string, unknown>) : {};
    const fullName = pickString(baseRepo.full_name);
    const [owner, repo] = fullName.includes("/") ? fullName.split("/", 2) : [parsed.owner, parsed.repo];
    const pr: PrMetadata = {
      owner: owner || parsed.owner,
      repo: repo || parsed.repo,
      number: typeof raw.number === "number" ? raw.number : parsed.number,
      url: pickString(raw.html_url) || input.pr,
      title: pickString(raw.title),
      baseSha: pickString(base.sha),
      headSha: pickString(head.sha),
      effectiveBaseSha: "",
      baseRefName: pickString(base.ref),
      headRefName: pickString(head.ref),
      isDraft: Boolean(raw.draft),
      cloneUrl: pickString(baseRepo.clone_url) || `https://github.com/${parsed.owner}/${parsed.repo}.git`,
    };

    const limitations = [
      pr.isDraft ? "The pull request is currently marked as draft." : "",
      !pr.baseSha ? "GitHub did not return a base SHA." : "",
      !pr.headSha ? "GitHub did not return a head SHA." : "",
    ].filter(Boolean);

    return {
      status: pr.baseSha && pr.headSha ? "resolved" : "failed",
      pr,
      summary: `Resolved PR ${pr.owner}/${pr.repo}#${pr.number}: ${pr.title}`,
      limitations,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      pr: emptyPr(input.pr),
      summary: "Could not resolve the GitHub pull request.",
      limitations: [message],
    };
  }
};

export const preparePullRequestCheckout = async (
  input: WorkflowInput,
  pr: PrMetadata,
): Promise<CheckoutResult> => {
  const commandsRun: string[] = [];
  const limitations: string[] = [];
  const checkoutParent = path.resolve(input.checkoutDir ?? os.tmpdir());

  try {
    await mkdir(checkoutParent, { recursive: true });
    const checkoutPath = await mkdtemp(path.join(checkoutParent, `${pr.owner}-${pr.repo}-pr-${pr.number}-`));
    const auditOutputDir = path.resolve(
      process.cwd(),
      input.outputDir ?? ".smithers/bug-regression-audit-pr-reports",
      `pr-${pr.number}`,
      "audit",
    );

    const ghCloneArgs = ["repo", "clone", `${pr.owner}/${pr.repo}`, checkoutPath, "--", "--no-checkout"];
    commandsRun.push(`gh ${ghCloneArgs.join(" ")}`);
    const clone = await runCommand("gh", ghCloneArgs, { timeoutMs: 10 * 60_000, allowFailure: true });
    if (clone.code !== 0) {
      const gitCloneArgs = ["clone", "--no-checkout", pr.cloneUrl, checkoutPath];
      commandsRun.push(`git ${gitCloneArgs.join(" ")}`);
      const fallbackClone = await runCommand("git", gitCloneArgs, { timeoutMs: 10 * 60_000, allowFailure: true });
      if (fallbackClone.code !== 0) {
        return {
          status: "failed",
          checkoutPath,
          auditOutputDir,
          effectiveBaseSha: pr.baseSha,
          summary: "Could not clone the repository for PR audit.",
          commandsRun,
          limitations: [
            clone.stderr.trim() || clone.stdout.trim() || "gh repo clone failed.",
            fallbackClone.stderr.trim() || fallbackClone.stdout.trim() || "git clone failed.",
          ],
        };
      }
      limitations.push("gh repo clone failed; git clone with the PR base clone URL was used instead.");
    }

    const fetchBaseArgs = ["-C", checkoutPath, "fetch", "origin", pr.baseSha, "--depth=1"];
    commandsRun.push(`git ${fetchBaseArgs.join(" ")}`);
    const fetchBase = await runCommand("git", fetchBaseArgs, { timeoutMs: 5 * 60_000, allowFailure: true });
    if (fetchBase.code !== 0) {
      const fetchBaseBranchArgs = ["-C", checkoutPath, "fetch", "origin", pr.baseRefName, "--depth=200"];
      commandsRun.push(`git ${fetchBaseBranchArgs.join(" ")}`);
      const fetchBaseBranch = await runCommand("git", fetchBaseBranchArgs, {
        timeoutMs: 5 * 60_000,
        allowFailure: true,
      });
      if (fetchBaseBranch.code !== 0) {
        limitations.push(fetchBaseBranch.stderr.trim() || "Could not fetch the PR base branch.");
      }
    }

    const fetchPrArgs = [
      "-C",
      checkoutPath,
      "fetch",
      "origin",
      `refs/pull/${pr.number}/head:refs/remotes/origin/pr/${pr.number}`,
      "--depth=200",
    ];
    commandsRun.push(`git ${fetchPrArgs.join(" ")}`);
    const fetchPr = await runCommand("git", fetchPrArgs, { timeoutMs: 5 * 60_000, allowFailure: true });
    if (fetchPr.code !== 0) {
      return {
        status: "failed",
        checkoutPath,
        auditOutputDir,
        effectiveBaseSha: pr.baseSha,
        summary: "Could not fetch the PR head ref.",
        commandsRun,
        limitations: [fetchPr.stderr.trim() || fetchPr.stdout.trim() || "git fetch refs/pull failed."],
      };
    }

    const checkoutArgs = ["-C", checkoutPath, "checkout", "--detach", pr.headSha];
    commandsRun.push(`git ${checkoutArgs.join(" ")}`);
    const checkout = await runCommand("git", checkoutArgs, { timeoutMs: 5 * 60_000, allowFailure: true });
    if (checkout.code !== 0) {
      return {
        status: "failed",
        checkoutPath,
        auditOutputDir,
        effectiveBaseSha: pr.baseSha,
        summary: "Could not check out the PR head SHA.",
        commandsRun,
        limitations: [checkout.stderr.trim() || checkout.stdout.trim() || "git checkout failed."],
      };
    }

    const verifyBaseArgs = ["-C", checkoutPath, "cat-file", "-e", `${pr.baseSha}^{commit}`];
    commandsRun.push(`git ${verifyBaseArgs.join(" ")}`);
    const verifyBase = await runCommand("git", verifyBaseArgs, { timeoutMs: 60_000, allowFailure: true });
    if (verifyBase.code !== 0) {
        return {
          status: "failed",
          checkoutPath,
          auditOutputDir,
          effectiveBaseSha: pr.baseSha,
          summary: "The PR base SHA is not available in the temporary checkout.",
        commandsRun,
        limitations: [verifyBase.stderr.trim() || "Could not verify the PR base commit."],
      };
    }

    const deepenBaseArgs = ["-C", checkoutPath, "fetch", "origin", pr.baseRefName, "--depth=1000"];
    commandsRun.push(`git ${deepenBaseArgs.join(" ")}`);
    const deepenBase = await runCommand("git", deepenBaseArgs, { timeoutMs: 5 * 60_000, allowFailure: true });
    if (deepenBase.code !== 0) {
      limitations.push(deepenBase.stderr.trim() || "Could not deepen the PR base branch before merge-base detection.");
    }

    const deepenPrArgs = [
      "-C",
      checkoutPath,
      "fetch",
      "origin",
      `refs/pull/${pr.number}/head:refs/remotes/origin/pr/${pr.number}`,
      "--depth=1000",
    ];
    commandsRun.push(`git ${deepenPrArgs.join(" ")}`);
    const deepenPr = await runCommand("git", deepenPrArgs, { timeoutMs: 5 * 60_000, allowFailure: true });
    if (deepenPr.code !== 0) {
      limitations.push(deepenPr.stderr.trim() || "Could not deepen the PR head ref before merge-base detection.");
    }

    const mergeBaseArgs = ["-C", checkoutPath, "merge-base", pr.baseSha, pr.headSha];
    commandsRun.push(`git ${mergeBaseArgs.join(" ")}`);
    const mergeBase = await runCommand("git", mergeBaseArgs, { timeoutMs: 60_000, allowFailure: true });
    const effectiveBaseSha = mergeBase.code === 0 && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : pr.baseSha;
    if (effectiveBaseSha === pr.baseSha && mergeBase.code !== 0) {
      limitations.push(
        mergeBase.stderr.trim() ||
          "Could not compute a merge base for the PR; the GitHub base SHA will be used as the audit baseline.",
      );
    }

    return {
      status: "ready",
      checkoutPath,
      auditOutputDir,
      effectiveBaseSha,
      summary: `Prepared detached checkout for ${pr.owner}/${pr.repo}#${pr.number}.`,
      commandsRun,
      limitations,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      checkoutPath: checkoutParent,
      auditOutputDir: path.resolve(process.cwd(), input.outputDir, `pr-${pr.number}`, "audit"),
      effectiveBaseSha: pr.baseSha,
      summary: "Unexpected failure while preparing the PR checkout.",
      commandsRun,
      limitations: [message],
    };
  }
};

const parseBase64JsonLines = <T>(stdout: string): T[] =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(Buffer.from(line, "base64").toString("utf8")) as T);

type RawPullRequestFile = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  patch?: string;
};

export const fetchPullRequestFiles = async (pr: PrMetadata): Promise<PullRequestFile[]> => {
  const result = await runCommand(
    "gh",
    ["api", "--paginate", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/files`, "--jq", ".[] | @base64"],
    { timeoutMs: 120_000 },
  );
  return parseBase64JsonLines<RawPullRequestFile>(result.stdout)
    .filter((file) => file.filename)
    .map((file) => ({
      filename: file.filename ?? "",
      previousFilename: file.previous_filename ?? null,
      status: file.status ?? "",
      patch: file.patch ?? null,
    }));
};

type BodyCarrier = {
  body?: string;
  id?: number;
  html_url?: string;
};

export const fetchExistingCommentBodies = async (pr: PrMetadata) => {
  const endpoints = [
    `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
    `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments`,
  ];
  const comments: BodyCarrier[] = [];
  for (const endpoint of endpoints) {
    const result = await runCommand("gh", ["api", "--paginate", endpoint, "--jq", ".[] | @base64"], {
      timeoutMs: 120_000,
      allowFailure: true,
    });
    if (result.code === 0) {
      comments.push(...parseBase64JsonLines<BodyCarrier>(result.stdout));
    }
  }
  return comments;
};

export const createIssueComment = async (pr: PrMetadata, body: string) => {
  const result = await runCommand(
    "gh",
    ["api", "-X", "POST", `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, "--input", "-"],
    { input: JSON.stringify({ body }), timeoutMs: 120_000 },
  );
  return JSON.parse(result.stdout) as { html_url?: string };
};

export const updateIssueComment = async (owner: string, repo: string, commentId: number, body: string) => {
  const result = await runCommand(
    "gh",
    ["api", "-X", "PATCH", `repos/${owner}/${repo}/issues/comments/${commentId}`, "--input", "-"],
    { input: JSON.stringify({ body }), timeoutMs: 120_000 },
  );
  return JSON.parse(result.stdout) as { html_url?: string };
};

export const createPullRequestReview = async (
  pr: PrMetadata,
  body: string,
  comments: Array<{ path: string; line: number; side: "RIGHT"; body: string }>,
) => {
  const result = await runCommand(
    "gh",
    ["api", "-X", "POST", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, "--input", "-"],
    {
      input: JSON.stringify({
        commit_id: pr.headSha,
        event: "COMMENT",
        body,
        comments,
      }),
      timeoutMs: 120_000,
    },
  );
  return JSON.parse(result.stdout) as { html_url?: string };
};
