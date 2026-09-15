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
  const cfg = (raw as HMedeirosProviderConfig).modelsDiscovery;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {};
  const out: DiscoveryOptions = {};
  if (typeof cfg.enabled === "boolean") out.enabled = cfg.enabled;
  if (typeof cfg.endpoint === "string" && cfg.endpoint.length > 0) out.endpoint = cfg.endpoint;
  if (typeof cfg.timeoutMs === "number" && Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0) {
    out.timeoutMs = cfg.timeoutMs;
  }
  if (typeof cfg.apiKey === "string" && cfg.apiKey.trim().length > 0) out.apiKey = cfg.apiKey;
  if (Array.isArray(cfg.includeRegex)) {
    out.includeRegex = cfg.includeRegex.filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(cfg.excludeRegex)) {
    out.excludeRegex = cfg.excludeRegex.filter((v): v is string => typeof v === "string");
  }
  if (typeof cfg.smartName === "boolean") out.smartName = cfg.smartName;
  return out;
}

export function getConfiguredApiKey(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const direct = (raw as HMedeirosProviderConfig).apiKey;
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  const options = (raw as HMedeirosProviderConfig).options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const nested = (options as Record<string, unknown>).apiKey;
    if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
  }
  return undefined;
}

export function resolveBaseURL(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const baseURL = (raw as HMedeirosProviderConfig).baseURL;
  if (typeof baseURL !== "string" || baseURL.trim().length === 0) return undefined;
  try {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return baseURL;
  } catch {
    return undefined;
  }
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
