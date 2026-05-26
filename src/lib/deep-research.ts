import type { LlmConfig, SearchApiConfig } from "@/types/config"
import {
  defaultDeepResearchRuntime,
  type DeepResearchRuntime,
} from "@/lib/deep-research-runtime"
import { executeDeepResearchTask } from "@/lib/deep-research-coordinator"

/**
 * Queue a deep research task. Automatically starts processing if under concurrency limit.
 */
export function queueResearch(
  projectPath: string,
  topic: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
  searchQueries?: string[],
  runtime: DeepResearchRuntime = defaultDeepResearchRuntime,
): string {
  const taskId = runtime.addTask(topic)
  // Store search queries on the task
  if (searchQueries && searchQueries.length > 0) {
    runtime.updateTask(taskId, { searchQueries })
  }
  // Ensure panel is open
  runtime.setPanelOpen(true)
  // Start processing on next tick to ensure React has rendered the panel
  setTimeout(() => {
    processQueue(projectPath, llmConfig, searchConfig, runtime)
  }, 50)
  return taskId
}

/**
 * Process queued tasks up to maxConcurrent limit.
 */
function processQueue(
  projectPath: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
  runtime: DeepResearchRuntime = defaultDeepResearchRuntime,
) {
  const running = runtime.getRunningCount()
  const available = runtime.getMaxConcurrent() - running

  for (let i = 0; i < available; i++) {
    const next = runtime.getNextQueued()
    if (!next) break
    executeResearch(projectPath, next.id, next.topic, llmConfig, searchConfig, runtime)
  }
}

async function executeResearch(
  projectPath: string,
  taskId: string,
  topic: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
  runtime: DeepResearchRuntime = defaultDeepResearchRuntime,
) {
  await executeDeepResearchTask(projectPath, taskId, topic, llmConfig, searchConfig, runtime)
  onTaskFinished(projectPath, llmConfig, searchConfig, runtime)
}

function onTaskFinished(
  projectPath: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
  runtime: DeepResearchRuntime = defaultDeepResearchRuntime,
) {
  // Process next queued task
  setTimeout(() => processQueue(projectPath, llmConfig, searchConfig, runtime), 100)
}
