import { createRequire } from "node:module";
import type { Plugin } from "@opencode-ai/plugin";
import { discoverModels, isValidModel, DEFAULT_MODELS_ENDPOINT } from "./discovery.js";
import {
  buildModalities,
  compilePatterns,
  isImageOnlyModel,
  shouldKeepModel,
  toModelConfig,
} from "./models.js";
import {
  defaultEnabled,
  effectiveTimeout,
  expandConfigReference,
  getConfiguredApiKey,
  isHMedeirosProvider,
  readDiscoveryOptions,
  resolveBaseURL,
  shouldDiscover,
} from "./config.js";

const DEFAULT_CONFIG_HOOK_TIMEOUT_MS = 5000;
const RESOLVED_PROVIDERS_TIMEOUT_MS = 250;

interface LogExtra {
  [key: string]: unknown;
}

function log(client: any, level: "info" | "warn" | "error", message: string, extra?: LogExtra): void {
  try {
    void client?.app?.log?.({
      body: { service: "opencode-hmedeiros-ai", level, message, extra: extra ?? {} },
    });
  } catch {
    // logging must never break discovery
  }
}

async function resolveApiKey(
  client: any,
  providerId: string,
  providerConfig: any,
  explicitApiKey?: string,
): Promise<string | undefined> {
  if (explicitApiKey) {
    const expanded = expandConfigReference(explicitApiKey);
    if (expanded) return expanded;
  }
  const configured = getConfiguredApiKey(providerConfig);
  if (configured) return configured;
  try {
    const loadProviders = client?.config?.providers;
    if (typeof loadProviders === "function") {
      const resolved = await Promise.race([
        loadProviders.call(client.config),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RESOLVED_PROVIDERS_TIMEOUT_MS)),
      ]);
      const list = (resolved as any)?.data?.providers;
      if (Array.isArray(list)) {
        const found = list.find((p: any) => p?.id === providerId);
        if (typeof found?.key === "string" && found.key.trim().length > 0) return found.key.trim();
      }
    }
  } catch {
    // fall through to auth.json lookup
  }
  // Fallback: host auth store (~/.local/share/opencode/auth.json), same
  // approach as opencode-models-discovery for /connect-managed keys.
  try {
    const req = createRequire(import.meta.url);
    const fs = req("node:fs") as typeof import("node:fs");
    const os = req("node:os") as typeof import("node:os");
    const path = req("node:path") as typeof import("node:path");
    const candidates: string[] = [];
    if (typeof process.env.OPENCODE_AUTH_CONTENT === "string" && process.env.OPENCODE_AUTH_CONTENT.length > 0) {
      try {
        const auths = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, any>;
        const entry = auths?.[providerId];
        if (entry?.type === "api" && typeof entry.key === "string" && entry.key.trim().length > 0) {
          return entry.key.trim();
        }
      } catch {
        // ignore malformed content
      }
    }
    const xdgData =
      process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0
        ? process.env.XDG_DATA_HOME
        : path.join(os.homedir(), ".local", "share");
    if (process.env.MIMOCODE === "1") candidates.push(path.join(xdgData, "mimocode", "auth.json"));
    candidates.push(path.join(xdgData, "opencode", "auth.json"));
    for (const file of candidates) {
      try {
        const auths = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;
        const entry = auths?.[providerId] ?? auths?.[`${providerId}/`];
        if (entry?.type === "api" && typeof entry.key === "string" && entry.key.trim().length > 0) {
          return entry.key.trim();
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export const HMedeirosAIPlugin: Plugin = async ({ client }) => {
  if (!client || typeof client !== "object") {
    return { config: async () => {} };
  }

  return {
    config: async (config: any) => {
      if (!config || typeof config !== "object") return;
      if (Object.isFrozen?.(config) || Object.isSealed?.(config)) {
        log(client, "warn", "Config object is frozen or sealed; skipping discovery");
        return;
      }
      const providers = config.provider;
      if (!providers || typeof providers !== "object") return;

      const fallbackEnabled = defaultEnabled();
      const jobs: { promise: Promise<void>; timeoutMs: number }[] = [];

      for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (!isHMedeirosProvider(providerId, providerConfig)) continue;
        const opts = readDiscoveryOptions(providerConfig);
        if (!shouldDiscover(opts, fallbackEnabled)) {
          log(client, "info", "Discovery disabled for provider", { provider: providerId });
          continue;
        }
        const baseURL = resolveBaseURL(providerConfig);
        if (!baseURL) {
          log(client, "warn", "Provider has no valid baseURL; skipping discovery", {
            provider: providerId,
          });
          continue;
        }
        const timeoutMs = effectiveTimeout(opts);
        jobs.push({
          timeoutMs,
          promise:
          (async () => {
            const apiKey = await resolveApiKey(client, providerId, providerConfig, opts.apiKey);
            const discovery = await discoverModels(
              baseURL,
              apiKey,
              opts.endpoint ?? DEFAULT_MODELS_ENDPOINT,
              timeoutMs,
            );
            if (!discovery.ok) {
              log(client, "warn", "Model discovery failed", { provider: providerId, baseURL });
              return;
            }
            const include = compilePatterns(opts.includeRegex);
            const exclude = compilePatterns(opts.excludeRegex);
            const smartName = opts.smartName !== false;
            const discovered: Record<string, unknown> = {};
            const explicit = ((providerConfig as any).models ?? {}) as Record<string, unknown>;
            for (const model of discovery.models.filter(isValidModel)) {
              if (!shouldKeepModel(model.id, include, exclude)) continue;
              if (isImageOnlyModel(model)) continue;
              const cfg = toModelConfig(model, smartName);
              // Image-capable chat models keep modalities from the gateway payload.
              if (/image/i.test(model.id)) {
                const m = buildModalities(model);
                if (m) cfg.modalities = m;
              }
              discovered[model.id] = cfg;
            }
            (providerConfig as any).models = { ...discovered, ...explicit };
            log(client, "info", "Model discovery completed", {
              provider: providerId,
              modelCount: Object.keys(discovered).length,
            });
          })(),
        });
      }

      if (jobs.length === 0) return;
      // The hook wait budget must cover the slowest provider request, same as
      // opencode-models-discovery: max(default, largest configured timeout).
      const hookTimeoutMs = Math.max(
        DEFAULT_CONFIG_HOOK_TIMEOUT_MS,
        ...jobs.map((j) => j.timeoutMs),
      );
      try {
        await Promise.race([
          Promise.all(jobs.map((j) => j.promise)),
          new Promise<void>((resolve) => setTimeout(() => resolve(), hookTimeoutMs)),
        ]);
      } catch (error) {
        log(client, "error", "Model discovery failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
};
