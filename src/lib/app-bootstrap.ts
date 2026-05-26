import i18n from "@/i18n"
import { openProject } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import {
  getLastProject,
  initializeAppStateStore,
  loadActivePresetId,
  loadApiConfig,
  loadEmbeddingConfig,
  loadLanguage,
  loadLlmConfig,
  loadMultimodalConfig,
  loadPromptConfig,
  loadProviderConfigs,
  loadProxyConfig,
  loadSearchApiConfig,
  loadWorkflowPreset,
  saveLlmConfig,
} from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"

export async function initializeApp(
  openProjectSession: (project: WikiProject) => Promise<void>,
): Promise<void> {
  const store = useWikiStore.getState()
  const appStateHealth = await initializeAppStateStore()
  if (appStateHealth.migrated) {
    console.info(
      `[app-state] migrated schema v${appStateHealth.schemaVersion}: ${appStateHealth.migratedKeys.join(", ")}`,
    )
  }
  for (const warning of appStateHealth.warnings) {
    console.warn(`[app-state] ${warning}`)
  }

  const savedConfig = await loadLlmConfig()
  if (savedConfig) {
    store.setLlmConfig(savedConfig)
  }

  const savedProviderConfigs = await loadProviderConfigs()
  if (savedProviderConfigs) {
    store.setProviderConfigs(savedProviderConfigs)
  }

  const savedActivePreset = await loadActivePresetId()
  if (savedActivePreset) {
    store.setActivePresetId(savedActivePreset)
    const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
    const { resolveConfig } = await import("@/components/settings/preset-resolver")
    const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
    if (preset) {
      const currentFallback = useWikiStore.getState().llmConfig
      const override = (savedProviderConfigs ?? {})[savedActivePreset]
      const resolved = resolveConfig(preset, override, currentFallback)
      store.setLlmConfig(resolved)
      await saveLlmConfig(resolved)
    }
  }

  const savedSearchConfig = await loadSearchApiConfig()
  if (savedSearchConfig) {
    store.setSearchApiConfig(savedSearchConfig)
  }

  const savedEmbeddingConfig = await loadEmbeddingConfig()
  if (savedEmbeddingConfig) {
    store.setEmbeddingConfig(savedEmbeddingConfig)
  }

  const savedMultimodalConfig = await loadMultimodalConfig()
  if (savedMultimodalConfig) {
    store.setMultimodalConfig(savedMultimodalConfig)
  }

  const savedProxy = await loadProxyConfig()
  if (savedProxy) {
    store.setProxyConfig(savedProxy)
  }

  const savedApi = await loadApiConfig()
  if (savedApi) {
    store.setApiConfig({
      enabled: typeof savedApi.enabled === "boolean" ? savedApi.enabled : true,
      allowUnauthenticated:
        typeof savedApi.allowUnauthenticated === "boolean"
          ? savedApi.allowUnauthenticated
          : false,
      token: typeof savedApi.token === "string" ? savedApi.token : "",
    })
  }

  try {
    const promptConfig = await loadPromptConfig()
    if (promptConfig.activeId) {
      store.setActivePromptTemplate(promptConfig.activeId)
    }
    if (Object.keys(promptConfig.customTemplates).length > 0) {
      store.setCustomPromptTemplates(promptConfig.customTemplates)
    }
  } catch (error) {
    console.warn("[prompt config load failed]", error)
  }

  try {
    const workflowPreset = await loadWorkflowPreset()
    if (workflowPreset) {
      store.setActiveWorkflowPreset(workflowPreset)
    }
  } catch (error) {
    console.warn("[workflow preset load failed]", error)
  }

  const savedLanguage = await loadLanguage()
  if (savedLanguage) {
    await i18n.changeLanguage(savedLanguage)
  }

  const lastProject = await getLastProject()
  if (!lastProject) return

  try {
    const project = await openProject(lastProject.path)
    await openProjectSession(project)
  } catch (error) {
    console.warn("[last project restore failed]", error)
  }
}
