---
name: auto-model-selector
description: Select the best Codex model and reasoning effort for a user prompt with Jev, or explain and troubleshoot the Codex Jev model-routing plugin.
---

# Auto Model Selector

Use the bundled Jev router when the user asks to choose a model, route a Codex task, or diagnose this plugin.

## Routing

- Run `${PLUGIN_ROOT}/scripts/route.mjs` with the complete task prompt when a recommendation is needed without starting a new Codex process.
- Prefer `${PLUGIN_ROOT}/scripts/codex-auto.mjs -- <prompt>` when the user wants automatic selection before an interactive Codex session starts.
- Add `--exec` for a non-interactive `codex exec` run and `--dry-run` to inspect the selection without starting Codex.
- Preserve an explicit model request from the user.
- Never claim that a `UserPromptSubmit` hook changed the active model. Codex fixes that model before this hook runs; the hook can recommend a model or guide delegation, while the launcher can select the model before startup.

## Safety and credentials

- Require `AI_GATEWAY_API_KEY` in the local environment. Never ask the user to paste it into chat or print it.
- The router sends the prompt to Vercel AI Gateway and TypeSafe Jev. Make that data flow clear before users enable automatic routing for sensitive work.
- The router locally skips prompts that resemble credentials or private keys and selects a conservative fallback.
- Treat Jev probabilities as routing evidence, not proof. The deterministic policy holds low-confidence choices at GPT-5.6 Sol and upgrades high-stakes tasks to GPT-6 Astra.
- Recommend Luna only for easy tasks and always with `xhigh` or `max` effort. Use Sol for most tasks. Reserve Astra for hard tasks that Sol is unlikely to complete correctly.
