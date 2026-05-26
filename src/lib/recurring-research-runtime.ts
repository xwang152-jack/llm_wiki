import { useResearchStore, type RecurringResearchTask, type ResearchTask } from "@/stores/research-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig, SearchApiConfig } from "@/types/config"

export interface RecurringResearchRuntime {
  getRecurringTasks: () => RecurringResearchTask[]
  getResearchTask: (taskId: string) => ResearchTask | undefined
  updateRecurringTaskLastRun: (taskId: string, summary: string) => void
  addReviewItems: (
    items: Omit<ReviewItem, "id" | "resolved" | "createdAt" | "priority">[],
  ) => void
  getLlmConfig: () => LlmConfig
  getSearchApiConfig: () => SearchApiConfig
}

export const defaultRecurringResearchRuntime: RecurringResearchRuntime = {
  getRecurringTasks: () => useResearchStore.getState().recurringTasks,
  getResearchTask: (taskId) => useResearchStore.getState().tasks.find((task) => task.id === taskId),
  updateRecurringTaskLastRun: (taskId, summary) =>
    useResearchStore.getState().updateRecurringTaskLastRun(taskId, summary),
  addReviewItems: (items) => useReviewStore.getState().addItems(items),
  getLlmConfig: () => useWikiStore.getState().llmConfig,
  getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
}
