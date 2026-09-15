import { createRequire } from "node:module";
import type { DiscoveryOptions } from "./types.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "./discovery.js";

export interface HMedeirosProviderConfig {
  baseURL?: unknown;
  apiKey?: unknown;
  modelsDiscovery?: DiscoveryOptions | null;
  [key: string]: unknown;
}

export function readDiscoveryOptions(raw: unknown): DiscoveryOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const cfg = raw as HMedeirosProviderConfig;
  // Support both `provider.<id>.modelsDiscovery` and
  // `provider.<id>.options.modelsDiscovery` (used by opencode-models-discovery).
  // `options.modelsDiscovery` wins on conflicts.
  const top = cfg.modelsDiscovery;
  let nested: unknown;
  if (cfg.options && typeof cfg.options === "object" && !Array.isArray(cfg.options)) {
    nested = (cfg.options as Record<string, unknown>).modelsDiscovery;
  }
  const merged: Record<string, unknown> =
    typeof top === "object" && top !== null && !Array.isArray(top)
      ? { ...(top as Record<string, unknown>) }
      : {};
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    Object.assign(merged, nested as Record<string, unknown>);
  }
  if (Object.keys(merged).length === 0) return {};
  const out: DiscoveryOptions = {};
  if (typeof merged.enabled === "boolean") out.enabled = merged.enabled;
  if (typeof merged.endpoint === "string" && merged.endpoint.length > 0) out.endpoint = merged.endpoint;
  if (typeof merged.timeoutMs === "number" && Number.isFinite(merged.timeoutMs) && merged.timeoutMs > 0) {
    out.timeoutMs = merged.timeoutMs;
  }
  if (typeof merged.apiKey === "string" && merged.apiKey.trim().length > 0) out.apiKey = merged.apiKey;
  if (Array.isArray(merged.includeRegex)) {
    out.includeRegex = (merged.includeRegex as unknown[]).filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(merged.excludeRegex)) {
    out.excludeRegex = (merged.excludeRegex as unknown[]).filter((v): v is string => typeof v === "string");
  }
  if (typeof merged.smartName === "boolean") out.smartName = merged.smartName;
  // Legacy/alternate nesting: provider.<id>.options.modelsDiscovery.models.{include,exclude}Regex
  const nestedModels = (merged as Record<string, unknown>).models;
  if (nestedModels && typeof nestedModels === "object" && !Array.isArray(nestedModels)) {
    const m = nestedModels as Record<string, unknown>;
    if (out.includeRegex === undefined && Array.isArray(m.includeRegex)) {
      out.includeRegex = (m.includeRegex as unknown[]).filter((v): v is string => typeof v === "string");
    }
    if (out.excludeRegex === undefined && Array.isArray(m.excludeRegex)) {
      out.excludeRegex = (m.excludeRegex as unknown[]).filter((v): v is string => typeof v === "string");
    }
  }
  return out;
}

/**
 * Resolve a literal `{env:VAR}` / `{file:path}` placeholder to its value.
 * Returns undefined when the reference cannot be resolved — the caller must
 * treat that as "no key available", never send the placeholder as a key.
 */
export function expandConfigReference(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^\{(env|file):([^}]*)\}$/.exec(trimmed);
  if (!match) return trimmed;
  const kind = match[1];
  const ref = (match[2] ?? "").trim();
  if (!ref) return undefined;
  if (kind === "env") {
    const envVal = process.env[ref];
    return envVal && envVal.trim().length > 0 ? envVal.trim() : undefined;
  }
  try {
    const req = createRequire(import.meta.url);
    const fs = req("node:fs") as typeof import("node:fs");
    const os = req("node:os") as typeof import("node:os");
    let p = ref;
    if (p.startsWith("~")) p = os.homedir() + p.slice(1);
    const content = fs.readFileSync(p, "utf8");
    return typeof content === "string" && content.trim().length > 0 ? content.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getConfiguredApiKey(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidates: unknown[] = [
    (raw as HMedeirosProviderConfig).apiKey,
  ];
  const options = (raw as HMedeirosProviderConfig).options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    candidates.push((options as Record<string, unknown>).apiKey);
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
    const resolved = expandConfigReference(candidate);
    if (resolved === undefined || resolved.length === 0) continue;
    return resolved;
  }
  return undefined;
}

function pickBaseURL(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const cfg = raw as HMedeirosProviderConfig;
  const candidates: unknown[] = [cfg.baseURL];
  const options = cfg.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const o = options as Record<string, unknown>;
    candidates.push(o.baseURL, o.endpoint);
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
    const trimmed = candidate.trim();
    if (/^\{(env|file):[^}]*\}$/.test(trimmed)) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return trimmed;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function resolveBaseURL(raw: unknown): string | undefined {
  return pickBaseURL(raw);
}

export function isHMedeirosProvider(providerId: string, raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const cfg = raw as HMedeirosProviderConfig;
  if (providerId === "hmedeiros-ai" || providerId === "hmedeiros_ai") return true;
  const name = cfg["name"];
  if (typeof name === "string" && /hmedeiros\s*ai/i.test(name)) return true;
  const baseURL = resolveBaseURL(raw);
  if (baseURL) {
    try {
      const host = new URL(baseURL).hostname.toLowerCase();
      if (host === "ai.hmedeiros.dev") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function defaultEnabled(): boolean {
  const raw = process.env.HMEDEIROS_AI_DISCOVERY_DEFAULT_ENABLED;
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return true;
}

export function shouldDiscover(
  opts: DiscoveryOptions,
  fallbackEnabled = true,
): boolean {
  if (opts.enabled === true) return true;
  if (opts.enabled === false) return false;
  return fallbackEnabled;
}

export function effectiveTimeout(opts: DiscoveryOptions): number {
  return opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
}
