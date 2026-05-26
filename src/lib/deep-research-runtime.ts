import { listDirectory } from "@/commands/fs"
import { autoIngest } from "@/lib/ingest"
import { useResearchStore, type ResearchTask } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig } from "@/types/config"

export interface DeepResearchRuntime {
  addTask: (topic: string) => string
  updateTask: (taskId: string, updates: Partial<ResearchTask>) => void
  setPanelOpen: (open: boolean) => void
  getRunningCount: () => number
  getMaxConcurrent: () => number
  getNextQueued: () => ResearchTask | undefined
  getTask: (taskId: string) => ResearchTask | undefined
  refreshProjectTree: (projectPath: string) => Promise<void>
  autoIngestResearchPage: (projectPath: string, savedPath: string, llmConfig: LlmConfig) => Promise<void>
}

export const defaultDeepResearchRuntime: DeepResearchRuntime = {
  addTask: (topic) => useResearchStore.getState().addTask(topic),
  updateTask: (taskId, updates) => useResearchStore.getState().updateTask(taskId, updates),
  setPanelOpen: (open) => useResearchStore.getState().setPanelOpen(open),
  getRunningCount: () => useResearchStore.getState().getRunningCount(),
  getMaxConcurrent: () => useResearchStore.getState().maxConcurrent,
  getNextQueued: () => useResearchStore.getState().getNextQueued(),
  getTask: (taskId) => useResearchStore.getState().tasks.find((task) => task.id === taskId),
  refreshProjectTree: async (projectPath) => {
    try {
      const tree = await listDirectory(projectPath)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // ignore refresh failures
    }
  },
  autoIngestResearchPage: async (projectPath, savedPath, llmConfig) => {
    await autoIngest(projectPath, `${projectPath}/${savedPath}`, llmConfig)
  },
}
