#!/usr/bin/env node
import { routePrompt } from "./router-core.mjs";

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) throw new Error("Hook input is too large.");
  }
  return JSON.parse(input);
}

try {
  const event = await readStdin();
  if (!process.env.AI_GATEWAY_API_KEY) process.exit(0);

  const recommendation = await routePrompt(event.prompt, {
    currentModel: event.model,
  });
  const confidence =
    recommendation.modelConfidence == null
      ? "unknown"
      : recommendation.modelConfidence.toFixed(2);
  const sameModel = recommendation.model === event.model;
  const note = recommendation.skipped
    ? recommendation.reasons[0]
    : `Jev recommends ${recommendation.model} at ${recommendation.effort} effort (model confidence ${confidence}).`;

  process.stdout.write(
    JSON.stringify({
      systemMessage: sameModel ? undefined : note,
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: [
          note,
          "This hook cannot replace the active model for an already-started turn.",
          sameModel
            ? "Continue with the active model."
            : "If model-overridden subagents are available and delegation is appropriate, use the recommended model for the primary work; otherwise continue without claiming that the active model changed.",
        ].join(" "),
      },
    }),
  );
} catch (error) {
  if (process.env.JEV_CODEX_DEBUG === "1") {
    process.stdout.write(
      JSON.stringify({
        systemMessage: `Jev model routing was skipped: ${error.message}`,
      }),
    );
  }
}
