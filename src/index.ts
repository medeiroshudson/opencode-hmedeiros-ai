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
  getConfiguredApiKey,
  isHMedeirosProvider,
  readDiscoveryOptions,
  resolveBaseURL,
  shouldDiscover,
} from "./config.js";

const CONFIG_HOOK_TIMEOUT_MS = 5000;

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
  if (explicitApiKey && explicitApiKey.trim().length > 0) return explicitApiKey.trim();
  const configured = getConfiguredApiKey(providerConfig);
  if (configured) return configured;
  try {
    const resolved = await client?.config?.providers?.();
    const list = resolved?.data?.providers;
    if (Array.isArray(list)) {
      const found = list.find((p: any) => p?.id === providerId);
      if (typeof found?.key === "string" && found.key.trim().length > 0) return found.key.trim();
    }
  } catch {
    // fall through to auth.json lookup
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
      const jobs: Promise<void>[] = [];

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
        jobs.push(
          (async () => {
            const timeoutMs = effectiveTimeout(opts);
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
        );
      }

      if (jobs.length === 0) return;
      try {
        await Promise.race([
          Promise.all(jobs),
          new Promise<void>((resolve) => setTimeout(() => resolve(), CONFIG_HOOK_TIMEOUT_MS)),
        ]);
      } catch (error) {
        log(client, "error", "Model discovery failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
};
