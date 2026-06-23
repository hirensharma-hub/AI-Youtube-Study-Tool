import { ProviderCatalogItem, ProviderId } from "@/types";

export const providerCatalog: Record<ProviderId, ProviderCatalogItem> = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    description: "Works with custom hosted endpoints via environment variables.",
    defaultModel: "llama3-70b:cloud" || "",
    modelSuggestions: "llama3-70b:cloud" ? ["llama3-70b:cloud"] : []
  }
};

export const providerList = Object.values(providerCatalog);
