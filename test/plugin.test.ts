import { describe, expect, it } from "vitest";
import { buildModelsURL, isValidModel } from "../src/discovery.js";
import {
  buildCost,
  buildLimit,
  compilePatterns,
  displayName,
  extractOwner,
  isImageOnlyModel,
  shouldKeepModel,
  toModelConfig,
} from "../src/models.js";
import {
  isHMedeirosProvider,
  readDiscoveryOptions,
  resolveBaseURL,
  shouldDiscover,
} from "../src/config.js";

describe("buildModelsURL", () => {
  it("derives /v1/models from the provider origin", () => {
    expect(buildModelsURL("https://ai.hmedeiros.dev/v1")).toBe("https://ai.hmedeiros.dev/v1/models");
  });

  it("keeps a custom endpoint path", () => {
    expect(buildModelsURL("https://ai.hmedeiros.dev/v1", "/custom/models")).toBe(
      "https://ai.hmedeiros.dev/custom/models",
    );
  });
});

describe("isValidModel", () => {
  it("accepts models with a non-empty id", () => {
    expect(isValidModel({ id: "opencode-zen/muse-spark-1.3" })).toBe(true);
  });

  it("rejects models without an id", () => {
    expect(isValidModel({ name: "x" })).toBe(false);
    expect(isValidModel(null)).toBe(false);
  });
});

describe("displayName", () => {
  it("prefers normalized_name from Bifrost", () => {
    expect(displayName({ id: "b-ai/qwen3.8-flash", normalized_name: "Qwen3.8 Flash" })).toBe(
      "Qwen3.8 Flash",
    );
  });

  it("falls back to a title-cased id", () => {
    expect(displayName({ id: "codex-lb/gpt-5.6-luna" }, false)).toBe("Codex Lb Gpt 5.6 Luna");
  });
});

describe("extractOwner", () => {
  it("extracts the namespace prefix", () => {
    expect(extractOwner("codex-lb/gpt-5.6-luna")).toBe("codex-lb");
  });

  it("returns undefined without a prefix", () => {
    expect(extractOwner("gpt-5")).toBeUndefined();
  });
});

describe("buildLimit", () => {
  it("builds limits from Bifrost token fields", () => {
    expect(
      buildLimit({ id: "m", context_length: 922000, max_input_tokens: 922000, max_output_tokens: 128000 }),
    ).toEqual({ context: 922000, input: 922000, output: 128000 });
  });

  it("returns undefined without usable output tokens", () => {
    expect(buildLimit({ id: "m", context_length: 1000 })).toBeUndefined();
  });
});

describe("buildCost", () => {
  it("converts per-token strings to per-million costs", () => {
    expect(
      buildCost({ id: "m", pricing: { prompt: "0.0000001500", completion: "0.0000004700" } }),
    ).toEqual({ input: 0.15, output: 0.47 });
  });

  it("returns undefined for missing pricing", () => {
    expect(buildCost({ id: "m" })).toBeUndefined();
  });
});

describe("isImageOnlyModel", () => {
  it("skips image models without chat context", () => {
    expect(isImageOnlyModel({ id: "codex-lb/gpt-image-2" })).toBe(true);
  });

  it("keeps chat models", () => {
    expect(isImageOnlyModel({ id: "opencode-zen/muse-spark-1.3", context_length: 100 })).toBe(false);
  });
});

describe("shouldKeepModel", () => {
  it("applies include and exclude filters", () => {
    expect(shouldKeepModel("a/1", compilePatterns(["^a/"]), [])).toBe(true);
    expect(shouldKeepModel("b/1", compilePatterns(["^a/"]), [])).toBe(false);
    expect(shouldKeepModel("a/1", [], compilePatterns(["1$"]))).toBe(false);
    expect(shouldKeepModel("a/1", [], [])).toBe(true);
  });
});

describe("toModelConfig", () => {
  it("maps a real Bifrost payload", () => {
    expect(
      toModelConfig({
        id: "b-ai/qwen3.8-flash",
        normalized_name: "Qwen3.8 Flash",
        context_length: 1000000,
        max_input_tokens: 1000000,
        pricing: { prompt: "0.0000001500", completion: "0.0000004700" },
      }),
    ).toMatchObject({
      id: "b-ai/qwen3.8-flash",
      name: "Qwen3.8 Flash",
      organizationOwner: "b-ai",
    });
  });
});

describe("provider matching", () => {
  it("matches by id, display name, or HMedeiros host", () => {
    expect(isHMedeirosProvider("hmedeiros-ai", {})).toBe(true);
    expect(isHMedeirosProvider("other", { name: "HMedeiros AI" })).toBe(true);
    expect(isHMedeirosProvider("other", { options: {}, baseURL: "https://ai.hmedeiros.dev/v1" })).toBe(true);
    expect(isHMedeirosProvider("other", { baseURL: "https://example.com/v1" })).toBe(false);
  });

  it("resolves only http(s) base URLs", () => {
    expect(resolveBaseURL({ baseURL: "https://ai.hmedeiros.dev/v1" })).toBe(
      "https://ai.hmedeiros.dev/v1",
    );
    expect(resolveBaseURL({})).toBeUndefined();
  });

  it("reads discovery options defensively", () => {
    expect(readDiscoveryOptions(null)).toEqual({});
    expect(readDiscoveryOptions({ modelsDiscovery: { enabled: true, timeoutMs: 2000 } })).toEqual({
      enabled: true,
      timeoutMs: 2000,
    });
  });

  it("respects explicit enable/disable", () => {
    expect(shouldDiscover({ enabled: true }, false)).toBe(true);
    expect(shouldDiscover({ enabled: false }, true)).toBe(false);
    expect(shouldDiscover({}, true)).toBe(true);
  });
});
