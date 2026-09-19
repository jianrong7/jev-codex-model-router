#!/usr/bin/env node
import { routePrompt } from "./router-core.mjs";

let prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  for await (const chunk of process.stdin) prompt += chunk;
  prompt = prompt.trim();
}

try {
  process.stdout.write(`${JSON.stringify(await routePrompt(prompt), null, 2)}\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
