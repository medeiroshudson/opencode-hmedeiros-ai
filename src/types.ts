export interface BifrostPricing {
  prompt?: string | number | null;
  completion?: string | number | null;
  [key: string]: unknown;
}

export interface BifrostModel {
  id: string;
  normalized_name?: string | null;
  name?: string | null;
  context_length?: number | null;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  pricing?: BifrostPricing | null;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface BifrostModelsResponse {
  object?: string;
  data?: BifrostModel[];
}

export interface ModelLimit {
  context: number;
  output: number;
  input?: number;
}

export interface ModelCost {
  input: number;
  output: number;
}

export interface DiscoveredModelConfig {
  id: string;
  name: string;
  organizationOwner?: string;
  limit?: ModelLimit;
  cost?: ModelCost;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  [key: string]: unknown;
}

export interface DiscoveryOptions {
  enabled?: boolean;
  endpoint?: string;
  timeoutMs?: number;
  apiKey?: string;
  includeRegex?: string[];
  excludeRegex?: string[];
  smartName?: boolean;
}

export interface DiscoveryResult {
  ok: boolean;
  models: BifrostModel[];
}
