import { useWikiStore } from "@/stores/wiki-store"
import type { OutputLanguage } from "@/types/config"

export interface OutputLanguageRuntime {
  getConfiguredOutputLanguage: () => OutputLanguage
}

export const defaultOutputLanguageRuntime: OutputLanguageRuntime = {
  getConfiguredOutputLanguage: () => useWikiStore.getState().outputLanguage,
}
