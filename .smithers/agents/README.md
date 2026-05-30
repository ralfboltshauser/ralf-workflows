# Agent Config

These files export the configured agent instances used by your Smithers workflows.

- `codex.ts` is user-owned config.
- Edit it to pin models, set `cwd`, add a shared `systemPrompt`, or enable Codex-specific flags.
- `index.ts` re-exports Codex so root-level files can import from `./agents`.

Examples:

```ts
import { CodexAgent } from "./agents/codex";
```

Inside `.smithers/workflows/*`, use `../agents` or `../agents/<name>` instead.

`smithers init` and `smithers init --agents-only` only create missing files in this directory.
Existing files here are left alone so your custom agent config is preserved.
