import { ProviderCatalogItem, ProviderId } from "@/types";

export const providerCatalog: Record<ProviderId, ProviderCatalogItem> = {
  ollama: {
    id: "ollama",
    label: "Ollama Cloud",
    description: "Runs through Ollama's hosted cloud models, trying the strongest model first and automatically falling back if needed.",
    defaultModel: "deepseek-v3.1:671b-cloud",
    modelSuggestions: [
      "deepseek-v3.1:671b-cloud",
      "gpt-oss:120b-cloud",
      "gpt-oss:20b-cloud"
    ]
  }
};

export const providerList = Object.values(providerCatalog);
