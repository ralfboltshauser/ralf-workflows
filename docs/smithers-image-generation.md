# Smithers Image Generation

Create a one-shot raster image from a prompt through Smithers using Codex built-in image generation.

This workflow is useful as a minimal proof that a Smithers task can call the local Codex CLI image tool and save the resulting bitmap to a specific file path. It does not call Pollinations, Replicate, stock image APIs, screenshots, SVG, canvas, or any other external image provider.

## Requirements

- A working local `codex` CLI login on the machine running Smithers.
- A Codex CLI build that exposes both feature flags:
  - `--enable image_generation`
  - `--enable imagegenext`
- Permission for the Smithers task to write the requested output path.

You can check the local feature flags with:

```bash
codex features list
```

In the verified Codex CLI environment, `image_generation` was stable and `imagegenext` was under development, but both were required for `codex exec` to expose the built-in image generation tool.

## Run

```bash
bunx smithers-orchestrator workflow run smithers-image-generation --input '{"prompt":"A clean startup pitch title slide for a construction technology company","outputDir":".smithers/image-generations/demo"}'
```

Write to an exact file path:

```bash
bunx smithers-orchestrator workflow run smithers-image-generation --input '{"prompt":"Zurich with purple whales flying in the air","style":"cinematic surreal cityscape, recognizable Zurich skyline and lake, high detail, no text","outputPath":".smithers/image-generations/demo/zurich-purple-whales.png"}'
```

If `outputPath` is omitted, the workflow writes `${outputDir}/${fileName}.png`.

## How It Works

The workflow is intentionally one Smithers task:

1. Record `Date.now()` before generation.
2. Run `codex exec` with repeated feature flags:

   ```bash
   codex exec --json \
     --enable image_generation \
     --enable imagegenext \
     -c suppress_unstable_features_warning=true \
     --sandbox read-only \
     --skip-git-repo-check \
     -C <workflow-repo> \
     '<image prompt>'
   ```

3. Find the newest generated image in `$CODEX_HOME/generated_images` whose modified time is after the start timestamp.
4. Copy it to `outputPath`.
5. Fail if no fresh image is found or if the copied file is suspiciously small.

The direct `codex exec` call is intentional. The current Smithers `CodexAgent` adapter serializes `enable: ["image_generation", "imagegenext"]` as `--enable image_generation imagegenext`; the installed Codex CLI requires repeated flags. Calling the CLI directly keeps the demo small and makes the feature-flag contract explicit.

If Codex built-in image generation is unavailable, or if no fresh local image appears under `$CODEX_HOME/generated_images`, the workflow fails instead of substituting another provider or returning a fake path.

## Inputs

- `prompt`: Image prompt.
- `style`: Optional style contract appended to the prompt.
- `outputDir`: Directory used when `outputPath` is omitted. Defaults to `.smithers/image-generations/latest`.
- `fileName`: File name used when `outputPath` is omitted. Defaults to `generated-image`.
- `outputPath`: Exact PNG path to write.
