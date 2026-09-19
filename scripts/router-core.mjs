import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";

export const MODEL_CATALOG = Object.freeze({
  "gpt-5.6-luna":
    "Fast and affordable. Choose for narrow, low-risk, well-specified tasks such as small edits, formatting, simple questions, or mechanical transformations.",
  "gpt-5.6-terra":
    "Balanced intelligence, speed, and cost. Choose for focused coding, repository exploration, document analysis, or reviews with clear scope and moderate complexity.",
  "gpt-5.6-sol":
    "Reliable everyday agentic workhorse. Choose for multi-file implementation, debugging, testing, research, and tasks needing sustained tool use or careful follow-through.",
  "gpt-6-astra":
    "Most capable model. Choose for difficult architecture, security, high-stakes decisions, ambiguous cross-system work, novel problems, or tasks where maximizing correctness dominates cost and latency.",
});

export const EFFORT_CATALOG = Object.freeze({
  low: "Straightforward work with little ambiguity or planning.",
  medium: "Normal implementation or analysis requiring several connected steps.",
  high: "Complex work requiring careful planning, validation, or debugging.",
  xhigh: "Very difficult, ambiguous, high-stakes, or long-horizon work.",
  max: "Exceptional tasks that should prioritize solution quality over latency and cost.",
});

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk|pk)-(?:live|test|proj)?[-_a-z0-9]{12,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*[^\s]{8,}/i,
];

export function containsLikelySecret(prompt) {
  return SECRET_PATTERNS.some(pattern => pattern.test(prompt));
}

export function buildQuestions() {
  return {
    model: {
      type: "choice",
      instructions:
        "Select the single best Codex model for completing the user's task. Optimize primarily for successful completion and correctness, then latency and cost. Respect an explicit user model request.",
      criteria: MODEL_CATALOG,
    },
    effort: {
      type: "choice",
      instructions:
        "Select the reasoning effort appropriate for this task. Prefer the lowest effort that preserves a high probability of correct, complete work.",
      criteria: EFFORT_CATALOG,
    },
    highStakes: {
      type: "boolean",
      instructions:
        "Would an incorrect result plausibly cause security, privacy, financial, legal, production, destructive-data, or other material harm?",
    },
  };
}

function topProbability(answer) {
  if (!answer?.probabilities) return undefined;
  return Math.max(...Object.values(answer.probabilities));
}

function normalizeRecommendation(body, currentModel) {
  const modelAnswer = body?.answers?.model;
  const effortAnswer = body?.answers?.effort;
  const highStakesAnswer = body?.answers?.highStakes;
  let model = modelAnswer?.choice;
  let effort = effortAnswer?.choice;
  const modelConfidence = topProbability(modelAnswer);
  const highStakesProbability = highStakesAnswer?.probability ?? 0;

  if (!(model in MODEL_CATALOG)) model = currentModel || "gpt-6-astra";
  if (!(effort in EFFORT_CATALOG)) effort = "high";

  const reasons = [];
  if (modelConfidence != null && modelConfidence < 0.55) {
    model = "gpt-6-astra";
    effort = "high";
    reasons.push("low routing confidence; upgraded for correctness");
  }
  if (highStakesProbability >= 0.55) {
    model = "gpt-6-astra";
    if (["low", "medium"].includes(effort)) effort = "high";
    reasons.push("high-stakes task; upgraded for safety");
  }

  return {
    model,
    effort,
    modelConfidence,
    highStakesProbability,
    reasons,
    usage: body?.usage,
    source: "jev",
  };
}

export async function routePrompt(
  prompt,
  {
    currentModel,
    apiKey = process.env.AI_GATEWAY_API_KEY,
    gatewayUrl = process.env.AI_GATEWAY_EVALUATION_URL || DEFAULT_GATEWAY_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 7000,
  } = {},
) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("A non-empty prompt is required.");
  }

  if (containsLikelySecret(prompt)) {
    return {
      model: currentModel || "gpt-6-astra",
      effort: "high",
      reasons: ["routing skipped because the prompt may contain a secret"],
      source: "local-safety-fallback",
      skipped: true,
    };
  }

  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not set.");
  }

  const response = await fetchImpl(gatewayUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "ai-gateway-protocol-version": "0.0.1",
      "ai-gateway-auth-method": "api-key",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": "typesafe-ai/jev",
    },
    body: JSON.stringify({
      state: {
        userPrompt: prompt,
        currentModel: currentModel || "unknown",
        objective:
          "Choose the best available Codex model and reasoning effort for this prompt.",
      },
      questions: buildQuestions(),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Jev routing failed (${response.status}): ${detail}`);
  }

  return normalizeRecommendation(await response.json(), currentModel);
}

export function buildCodexArgs(prompt, recommendation, { exec = false } = {}) {
  const args = [];
  if (exec) args.push("exec");
  args.push(
    "--model",
    recommendation.model,
    "--config",
    `model_reasoning_effort=\"${recommendation.effort}\"`,
    prompt,
  );
  return args;
}

function executableNames(platform) {
  return platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
}

function isUsableCodexBinary(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5000,
    });
    return probe.status === 0;
  } catch {
    return false;
  }
}

export function codexBinaryCandidates({
  env = process.env,
  platform = process.platform,
  userHome = homedir(),
} = {}) {
  const names = executableNames(platform);
  const candidates = [];

  if (env.CODEX_BIN) candidates.push(env.CODEX_BIN);
  if (env.CODEX_INSTALL_DIR) {
    for (const name of names) candidates.push(join(env.CODEX_INSTALL_DIR, name));
  }
  for (const name of names) candidates.push(join(userHome, ".local", "bin", name));
  if (platform === "darwin") {
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
  }
  for (const directory of (env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(join(directory, name));
  }

  return [...new Set(candidates)];
}

export function resolveCodexBinary(options = {}) {
  const candidates = codexBinaryCandidates(options);
  const binary = candidates.find(isUsableCodexBinary);
  if (binary) return binary;

  throw new Error(
    "No working Codex CLI binary was found. Install or update the standalone CLI, or set CODEX_BIN to a working executable. Checked: " +
      candidates.join(", "),
  );
}
