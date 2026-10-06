type ModelDefaults = {
  reasoning_effort?: DuckAIReasoningEffort;
  valid_reasoning_efforts?: Array<DuckAIReasoningEffort>;
};

export type DuckAIReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high";

export const DUCKAI_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
];

const DEFAULT_DUCKAI_MODELS: Record<string, ModelDefaults> = {
  "gpt-5.4-mini": {
    reasoning_effort: "none",
    valid_reasoning_efforts: ["none", "low"],
  },
  "gpt-5-mini": {
    reasoning_effort: "minimal",
    valid_reasoning_efforts: ["minimal", "low"],
  },
  "gpt-5.4-nano": {
    reasoning_effort: "none",
    valid_reasoning_efforts: ["none", "low"],
  },
  "tinfoil/gpt-oss-120b": {
    reasoning_effort: "low",
    valid_reasoning_efforts: ["low"],
  },
  "claude-haiku-4-5": {
    reasoning_effort: "none",
    valid_reasoning_efforts: ["none", "low"],
  },
  "mistral-small-2603": {},
};

function loadModels(): Record<string, ModelDefaults> {
  const raw = process.env.X_MODELS_JSON;
  if (!raw) return DEFAULT_DUCKAI_MODELS;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, ModelDefaults>;
    }
    console.warn(
      "X_MODELS_JSON must parse to a JSON object; using built-in defaults",
    );
  } catch (e) {
    console.warn(
      `X_MODELS_JSON parse failed (${(e as Error).message}); using built-in defaults`,
    );
  }
  return DEFAULT_DUCKAI_MODELS;
}

export const DUCKAI_MODELS: Record<string, ModelDefaults> = loadModels();
