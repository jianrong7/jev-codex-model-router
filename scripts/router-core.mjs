import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";

export const MODEL_CATALOG = Object.freeze({
  "gpt-5.6-luna":
    "Fast model for easy, narrow, low-risk, well-specified tasks and mechanical continuations. Do not choose it merely to save cost when the task needs the reliability of Sol.",
  "gpt-5.6-sol":
    "Default workhorse for most tasks, including implementation, debugging, testing, research, repository exploration, and sustained tool use.",
  "gpt-6-astra":
    "Frontier model reserved for genuinely hard, ambiguous, high-stakes, or novel tasks that Sol is unlikely to get right.",
});

export const EFFORT_CATALOG = Object.freeze({
  low: "Light reasoning for a task that is slightly easier than the model's normal workload.",
  medium: "Default reasoning for Sol and Astra on most tasks.",
  high: "Complex work requiring careful planning, validation, or debugging.",
  xhigh: "Default reasoning for Luna; also available for unusually deep work on stronger models.",
  max: "Maximum reasoning; use for Luna only when the easy task still benefits from its deepest reasoning, or for exceptional hard tasks.",
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
        "Select the single best Codex model for completing this task. Luna is only for easy, narrow, low-risk work. Sol is the default for most tasks. Choose Astra only for genuinely hard, ambiguous, risky, or novel work that Sol is unlikely to get right. Optimize for successful completion and correctness before latency and cost. Respect an explicit supported model request.",
      criteria: MODEL_CATALOG,
    },
    effort: {
      type: "choice",
      instructions:
        "Select reasoning effort together with the model tier. Luna may use only xhigh or max (normally xhigh). Sol and Astra should use medium for most tasks and low for slightly easier work; use higher effort only when the task clearly requires deeper reasoning.",
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

export function normalizeEffort(model, effort) {
  if (model === "gpt-5.6-luna") return effort === "max" ? "max" : "xhigh";
  return effort in EFFORT_CATALOG ? effort : "medium";
}

function normalizeRecommendation(body, currentModel) {
  const modelAnswer = body?.answers?.model;
  const effortAnswer = body?.answers?.effort;
  const highStakesAnswer = body?.answers?.highStakes;
  let model = modelAnswer?.choice;
  let effort = effortAnswer?.choice;
  const modelConfidence = topProbability(modelAnswer);
  const highStakesProbability = highStakesAnswer?.probability ?? 0;

  const supportedCurrentModel = currentModel in MODEL_CATALOG ? currentModel : undefined;
  if (!(model in MODEL_CATALOG)) model = supportedCurrentModel || "gpt-5.6-sol";
  if (!(effort in EFFORT_CATALOG)) effort = "medium";

  const reasons = [];
  if (modelConfidence != null && modelConfidence < 0.55) {
    model = "gpt-5.6-sol";
    effort = normalizeEffort(model, effort);
    reasons.push("low routing confidence; held at the Sol default");
  }
  if (highStakesProbability >= 0.55) {
    model = "gpt-6-astra";
    effort = normalizeEffort(model, effort === "low" ? "medium" : effort);
    reasons.push("high-stakes task; upgraded for safety");
  }

  effort = normalizeEffort(model, effort);

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
    const model = currentModel in MODEL_CATALOG ? currentModel : "gpt-5.6-sol";
    return {
      model,
      effort: normalizeEffort(model, "medium"),
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
