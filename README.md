# Codex Jev Model Router

Jev selects a Codex model and reasoning effort from each task's prompt. The plugin contains:

- a `UserPromptSubmit` hook that adds Jev's recommendation to the current turn;
- `codex-auto`, a launcher that selects the model before starting Codex;
- an `auto-model-selector` skill for explicit routing and troubleshooting.

## Setup

Set `AI_GATEWAY_API_KEY` in the environment that starts Codex. Prompts evaluated by the router are sent to Vercel AI Gateway and TypeSafe Jev. Prompts that resemble credentials or private keys are skipped locally.

The hook cannot replace the model of an already-started turn. Use the launcher for actual automatic selection:

```bash
node ./scripts/codex-auto.mjs -- "Fix the flaky integration tests"
node ./scripts/codex-auto.mjs --exec -- "Review the current diff"
node ./scripts/codex-auto.mjs --dry-run -- "Design a multi-region payment system"
```

The router prioritizes task completion and correctness. Low-confidence and high-stakes classifications are upgraded to `gpt-6-astra` with at least `high` reasoning effort.

## Codex binary discovery

The launcher probes candidate binaries with `--version` instead of trusting the first `codex` entry on `PATH`. It checks, in order:

1. `CODEX_BIN`, when set;
2. `CODEX_INSTALL_DIR`;
3. the standalone installer location at `~/.local/bin/codex`;
4. the Codex binary bundled with ChatGPT.app on macOS;
5. every `codex` entry on `PATH`.

To force a particular installation:

```bash
CODEX_BIN=/absolute/path/to/codex node ./scripts/codex-auto.mjs -- "Your task"
```

If no healthy binary is found, install or update the standalone Codex CLI using the installation command in the official OpenAI documentation.
