import { ProviderCatalogItem, ProviderId } from "@/types";

export const providerCatalog: Record<ProviderId, ProviderCatalogItem> = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    description: "Works with a local Ollama server by default and can still be pointed at a hosted endpoint if you want one later.",
    defaultModel: "llama3.2:3b",
    modelSuggestions: [
      "llama3.2:3b",
      "qwen2.5:7b",
      "mistral:7b",
      "deepseek-r1:8b",
      "gpt-oss:20b"
    ]
  }
};

export const providerList = Object.values(providerCatalog);
