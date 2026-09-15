import type {
  BifrostModel,
  DiscoveredModelConfig,
  ModelCost,
  ModelLimit,
} from "./types.js";

function hasUsableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseCostPerToken(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const SUPPORTED_MODALITIES = new Set(["text", "audio", "image", "video", "pdf"]);

function normalizeModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = [
    ...new Set(
      value
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().toLowerCase())
        .map((m) => (m === "speech" ? "audio" : m))
        .filter((m) => SUPPORTED_MODALITIES.has(m)),
    ),
  ];
  return out.length > 0 ? out : undefined;
}

function titleCase(id: string): string {
  return id
    .split(/[/:_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function displayName(model: BifrostModel, smartName = true): string {
  if (smartName) {
    const n = model.normalized_name ?? model.name;
    if (typeof n === "string" && n.length > 0) return n;
  }
  return titleCase(model.id);
}

export function extractOwner(modelId: string): string | undefined {
  const i = modelId.indexOf("/");
  if (i > 0) return modelId.slice(0, i);
  return undefined;
}

export function isImageOnlyModel(model: BifrostModel): boolean {
  return /image/i.test(model.id) && model.context_length == null;
}

export function buildLimit(model: BifrostModel): ModelLimit | undefined {
  const context = model.context_length;
  const input = model.max_input_tokens;
  const output = model.max_output_tokens;
  if (hasUsableNumber(context) && hasUsableNumber(output)) {
    return {
      context,
      output,
      ...(hasUsableNumber(input) ? { input } : {}),
    };
  }
  return undefined;
}

export function buildCost(model: BifrostModel): ModelCost | undefined {
  const pricing = model.pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return undefined;
  const input = parseCostPerToken(pricing.prompt);
  const output = parseCostPerToken(pricing.completion);
  if (input === undefined || output === undefined) return undefined;
  return { input: input * 1_000_000, output: output * 1_000_000 };
}

export function buildModalities(model: BifrostModel): DiscoveredModelConfig["modalities"] {
  const arch = model.architecture;
  if (arch && typeof arch === "object" && !Array.isArray(arch)) {
    const input = normalizeModalities(arch.input_modalities);
    const output = normalizeModalities(arch.output_modalities);
    if (input || output) {
      return {
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
      };
    }
  }
  return { input: ["text"], output: ["text"] };
}

export function toModelConfig(model: BifrostModel, smartName = true): DiscoveredModelConfig {
  const config: DiscoveredModelConfig = {
    id: model.id,
    name: displayName(model, smartName),
  };
  const owner = extractOwner(model.id);
  if (owner) config.organizationOwner = owner;
  const limit = buildLimit(model);
  if (limit) config.limit = limit;
  const cost = buildCost(model);
  if (cost) config.cost = cost;
  const modalities = buildModalities(model);
  if (modalities) config.modalities = modalities;
  return config;
}

export function compilePatterns(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? [])
    .map((p) => {
      try {
        return new RegExp(p);
      } catch {
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);
}

export function shouldKeepModel(
  modelId: string,
  include: RegExp[],
  exclude: RegExp[],
): boolean {
  if (include.length > 0) return include.some((r) => r.test(modelId));
  if (exclude.length > 0) return !exclude.some((r) => r.test(modelId));
  return true;
}
