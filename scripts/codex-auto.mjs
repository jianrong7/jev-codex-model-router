#!/usr/bin/env node
import { spawn } from "node:child_process";
import { buildCodexArgs, resolveCodexBinary, routePrompt } from "./router-core.mjs";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const exec = rawArgs.includes("--exec");
const prompt = rawArgs
  .filter(arg => !["--dry-run", "--exec", "--"].includes(arg))
  .join(" ")
  .trim();

if (!prompt) {
  console.error("Usage: codex-auto [--exec] [--dry-run] -- <prompt>");
  process.exit(2);
}

try {
  const recommendation = await routePrompt(prompt);
  const args = buildCodexArgs(prompt, recommendation, { exec });
  const codexBinary = resolveCodexBinary();
  console.error(
    `[jev-router] ${recommendation.model} / ${recommendation.effort}` +
      (recommendation.modelConfidence == null
        ? ""
        : ` / confidence ${recommendation.modelConfidence.toFixed(2)}`),
  );

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ recommendation, command: [codexBinary, ...args] }, null, 2)}\n`);
    process.exit(0);
  }

  const child = spawn(codexBinary, args, {
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", error => {
    console.error(`[jev-router] Could not start Codex: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
} catch (error) {
  console.error(`[jev-router] ${error.message}`);
  process.exit(1);
}
