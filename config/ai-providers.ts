import { ProviderCatalogItem, ProviderId } from "@/types";

export const providerCatalog: Record<ProviderId, ProviderCatalogItem> = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    description: "Works with custom hosted endpoints via environment variables.",
    defaultModel: "qwen3:1.7b",
    modelSuggestions: [
      "qwen3:1.7b",
      "qwen3:4b",
      "qwen2.5:3b",
      "llama3.2:3b",
      "mistral:7b",
      "gpt-oss:20b-cloud"
    ]
  }
};

export const providerList = Object.values(providerCatalog);
