# Hello World Operator Guide

## Purpose

`hello-world` is a smoke-test workflow. Use it to confirm that Smithers can load this workflow pack and run a simple task.

## Required Inputs

None.

## Example Run

```bash
bunx smithers-orchestrator workflow run hello-world --run-id hello-world-check
```

## Behavior

- Returns a static structured output with `message: "Hello World"`.
- Does not read project files.
- Does not write files.
- Does not call Codex, GitHub, the network, or any external service.

## Output

The workflow output is a single object:

```json
{
  "message": "Hello World"
}
```

## Approval and Retry Behavior

No human approval is required. Failures usually mean the Smithers runtime, dependency install, or workflow discovery setup is broken.
