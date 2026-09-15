import http from "node:http";
import https from "node:https";
import type { BifrostModel, BifrostModelsResponse, DiscoveryResult } from "./types.js";

export const DEFAULT_MODELS_ENDPOINT = "/v1/models";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const REQUEST_USER_AGENT = "opencode-hmedeiros-ai";

function requestJson<T>(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data: T | undefined) => {
      if (!settled) {
        settled = true;
        resolve(data);
      }
    };

    let urlObj: URL;
    try {
      urlObj = new URL(urlStr);
    } catch {
      finish(undefined);
      return;
    }
    const mod = urlObj.protocol === "https:" ? https : http;

    const req = mod.get(
      urlObj,
      { headers: { "User-Agent": REQUEST_USER_AGENT, ...headers }, timeout: timeoutMs },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            finish(undefined);
            return;
          }
          try {
            finish(JSON.parse(data) as T);
          } catch {
            finish(undefined);
          }
        });
        res.on("error", () => finish(undefined));
      },
    );

    req.on("error", () => finish(undefined));
    req.on("timeout", () => {
      req.destroy();
      finish(undefined);
    });
  });
}

export function buildModelsURL(baseURL: string, endpoint: string = DEFAULT_MODELS_ENDPOINT): string {
  const origin = new URL(baseURL).origin;
  return new URL(endpoint, origin).toString();
}

export async function discoverModels(
  baseURL: string,
  apiKey?: string,
  endpoint: string = DEFAULT_MODELS_ENDPOINT,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<DiscoveryResult> {
  let url: string;
  try {
    url = buildModelsURL(baseURL, endpoint);
  } catch {
    return { ok: false, models: [] };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  const data = await requestJson<BifrostModelsResponse>(url, headers, timeoutMs);
  const models = Array.isArray(data?.data) ? data.data : [];
  return data ? { ok: true, models } : { ok: false, models: [] };
}

export function isValidModel(model: unknown): model is BifrostModel {
  return (
    !!model &&
    typeof model === "object" &&
    typeof (model as BifrostModel).id === "string" &&
    (model as BifrostModel).id.length > 0
  );
}
