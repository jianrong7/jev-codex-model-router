import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexArgs,
  codexBinaryCandidates,
  containsLikelySecret,
  resolveCodexBinary,
  routePrompt,
} from "../scripts/router-core.mjs";

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("returns Jev's model and effort", async () => {
  const result = await routePrompt("Fix the failing unit tests", {
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        answers: {
          model: {
            type: "choice",
            choice: "gpt-5.6-sol",
            probabilities: { "gpt-5.6-sol": 0.82, "gpt-6-astra": 0.18 },
          },
          effort: { type: "choice", choice: "high" },
          highStakes: { type: "boolean", probability: 0.1 },
        },
      }),
  });

  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.effort, "high");
  assert.equal(result.modelConfidence, 0.82);
});

test("upgrades low-confidence routing to Astra", async () => {
  const result = await routePrompt("An ambiguous task", {
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        answers: {
          model: {
            type: "choice",
            choice: "gpt-5.6-luna",
            probabilities: { "gpt-5.6-luna": 0.4, "gpt-5.6-terra": 0.35 },
          },
          effort: { type: "choice", choice: "low" },
          highStakes: { type: "boolean", probability: 0.1 },
        },
      }),
  });

  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.effort, "high");
});

test("upgrades high-stakes routing to Astra", async () => {
  const result = await routePrompt("Review this production auth migration", {
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        answers: {
          model: {
            type: "choice",
            choice: "gpt-5.6-terra",
            probabilities: { "gpt-5.6-terra": 0.9 },
          },
          effort: { type: "choice", choice: "medium" },
          highStakes: { type: "boolean", probability: 0.8 },
        },
      }),
  });

  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.effort, "high");
});

test("does not send likely secrets to the gateway", async () => {
  let called = false;
  const result = await routePrompt("api_key=very-secret-value", {
    currentModel: "gpt-5.6-sol",
    fetchImpl: async () => {
      called = true;
      return response({});
    },
  });

  assert.equal(called, false);
  assert.equal(result.skipped, true);
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(containsLikelySecret("token=very-secret-value"), true);
});

test("builds Codex launch arguments", () => {
  assert.deepEqual(
    buildCodexArgs(
      "Fix it",
      { model: "gpt-5.6-sol", effort: "high" },
      { exec: true },
    ),
    [
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="high"',
      "Fix it",
    ],
  );
});

test("prefers an explicit working Codex binary", () => {
  assert.equal(
    resolveCodexBinary({ env: { CODEX_BIN: "/bin/echo", PATH: "" } }),
    "/bin/echo",
  );
});

test("includes the ChatGPT app binary on macOS", () => {
  assert.ok(
    codexBinaryCandidates({
      env: { PATH: "" },
      platform: "darwin",
      userHome: "/tmp/example-user",
    }).includes("/Applications/ChatGPT.app/Contents/Resources/codex"),
  );
});
