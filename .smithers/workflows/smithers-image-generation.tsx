// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Smithers Image Generation
// smithers-description: Create a one-shot image artifact from a prompt through a Smithers workflow.
// smithers-tags: image-generation, prompt, visual
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { z } from "zod/v4";

const imageResultSchema = z.object({
  prompt: z.string(),
  outputDir: z.string(),
  imagePath: z.string().min(1),
  provider: z.string(),
  model: z.string(),
  generationNotes: z.string(),
});

const { Workflow, Task, smithers } = createSmithers({
  input: z.object({
    prompt: z.string().default("A clean startup pitch title slide for a construction technology company."),
    style: z.string().default("minimal, clean, industrial SaaS, large confident typography"),
    outputDir: z.string().default(".smithers/image-generations/latest"),
    fileName: z.string().default("generated-image"),
    outputPath: z.string().optional().nullable(),
  }),
  image: imageResultSchema,
});

export default smithers((ctx) => {
  const requestedOutputPath = resolveOutputPath(ctx.input.outputPath, ctx.input.outputDir, ctx.input.fileName);
  const requestedOutputDir = dirname(requestedOutputPath);

  return (
    <Workflow name="smithers-image-generation">
      <Task id="generate-image" output={imageResultSchema} timeoutMs={1000 * 60 * 6}>
        {() =>
          generateImage({
            prompt: ctx.input.prompt,
            style: ctx.input.style,
            outputDir: requestedOutputDir,
            outputPath: requestedOutputPath,
          })
        }
      </Task>
    </Workflow>
  );
});

async function generateImage(input: {
  prompt: string;
  style: string;
  outputDir: string;
  outputPath: string;
}): Promise<z.infer<typeof imageResultSchema>> {
  const startedAt = Date.now();
  const imagePath = resolve(input.outputPath);
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });

  await runCodexImageGeneration(input.prompt, input.style, startedAt);

  const generatedImage = findNewestGeneratedImageAfter(startedAt);
  if (!generatedImage) {
    throw new Error("Codex finished, but no fresh generated image was found in $CODEX_HOME/generated_images.");
  }

  copyFileSync(generatedImage, imagePath);
  const size = statSync(imagePath).size;
  if (size < 25_000) {
    throw new Error(`Generated image is suspiciously small: ${imagePath} (${size} bytes).`);
  }

  return {
    prompt: `${input.prompt}\n\nStyle: ${input.style}`,
    outputDir,
    imagePath,
    provider: "codex-built-in-image-generation",
    model: "codex-built-in",
    generationNotes: `Ran codex exec with image_generation and imagegenext enabled, then copied ${generatedImage}. Output size: ${size} bytes.`,
  };
}

async function runCodexImageGeneration(prompt: string, style: string, startedAt: number): Promise<void> {
  const fullPrompt = `Use the built-in image generation tool to generate exactly one new PNG.

Prompt:
${prompt}

Style:
${style}

Requirements:
- Use Codex built-in image generation only.
- Do not use external image providers, screenshots, SVG, HTML, canvas, or placeholder art.
- Create a fresh image after ${new Date(startedAt).toISOString()}.`;

  await run("codex", [
    "exec",
    "--json",
    "--enable",
    "image_generation",
    "--enable",
    "imagegenext",
    "-c",
    "suppress_unstable_features_warning=true",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "-C",
    process.cwd(),
    fullPrompt,
  ]);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out.`));
    }, 1000 * 60 * 5);

    child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with code ${code}.\n${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

function findNewestGeneratedImageAfter(startedAt: number): string | null {
  const images = listGeneratedImages()
    .map((path) => ({ path, stat: statSync(path) }))
    .filter(({ stat }) => stat.mtimeMs >= startedAt && stat.size >= 25_000)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return images[0]?.path ?? null;
}

function listGeneratedImages(): string[] {
  const root = resolve(process.env.CODEX_HOME ?? join(process.env.HOME ?? ".", ".codex"), "generated_images");
  if (!existsSync(root)) return [];

  const images: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      if (entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name)) images.push(path);
    }
  };
  walk(root);
  return images;
}

function resolveOutputPath(outputPath: string | null | undefined, outputDir: string, fileName: string): string {
  if (outputPath && outputPath.trim()) {
    return resolve(outputPath);
  }
  const safeFileName = fileName.endsWith(".png") ? basename(fileName, extname(fileName)) : fileName;
  return resolve(join(outputDir, `${safeFileName}.png`));
}
