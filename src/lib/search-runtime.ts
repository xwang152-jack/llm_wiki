import { useWikiStore } from "@/stores/wiki-store"
import type { EmbeddingConfig } from "@/types/config"

export interface SearchRuntime {
  getEmbeddingConfig: () => EmbeddingConfig
  getSearchBoostPaths: (query: string) => Set<string>
}

export const defaultSearchRuntime: SearchRuntime = {
  getEmbeddingConfig: () => useWikiStore.getState().embeddingConfig,
  getSearchBoostPaths: (query) => useWikiStore.getState().getSearchBoostPaths(query),
}
