import { queueResearch } from "./deep-research"
import { streamChat } from "./llm-client"
import type { LlmConfig } from "@/types/config"
import type { RecurringResearchTask } from "@/stores/research-store"
import type { RecurringResearchRuntime } from "@/lib/recurring-research-runtime"

export interface RecurringTaskWaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

export function buildRecurringResearchReviewItem(recurring: RecurringResearchTask) {
  return {
    type: "suggestion" as const,
    title: `Research Update: ${recurring.topic}`,
    description: `New information detected for "${recurring.topic}". The latest research synthesis differs from the previous run. Review the updated research page to incorporate new findings.`,
    searchQueries: recurring.searchQueries ?? [recurring.topic],
    options: [
      { label: "View Research", action: "view-research" },
      { label: "Dismiss", action: "dismiss" },
    ],
  }
}

export async function waitForTaskCompletion(
  taskId: string,
  runtime: RecurringResearchRuntime,
  options: RecurringTaskWaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const intervalMs = options.intervalMs ?? 2000
  const start = Date.now()

  return new Promise((resolve) => {
    const check = () => {
      const task = runtime.getResearchTask(taskId)
      if (!task || task.status === "done" || task.status === "error") {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        console.warn(`[recurring-research] timed out waiting for task ${taskId}`)
        resolve()
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

export async function detectSignificantDifference(
  llmConfig: LlmConfig,
  topic: string,
  previous: string,
  current: string,
): Promise<boolean> {
  let answer = ""

  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content:
          "You are comparing two research summaries about the same topic. " +
          "Reply with ONLY 'YES' if there are significant differences " +
          "(new facts, changed conclusions, important updates). " +
          "Reply with ONLY 'NO' if the content is substantially the same. " +
          "Do not include any other text.",
      },
      {
        role: "user",
        content:
          `Topic: ${topic}\n\n` +
          `## Previous Summary\n${previous}\n\n` +
          `## Current Summary\n${current}\n\n` +
          `Are there significant differences?`,
      },
    ],
    {
      onToken: (token) => {
        answer += token
      },
      onDone: () => {},
      onError: (err) => {
        throw err
      },
    },
  )

  return answer.trim().toUpperCase().startsWith("Y")
}

export async function executeRecurringResearchTask(
  projectPath: string,
  recurring: RecurringResearchTask,
  runtime: RecurringResearchRuntime,
): Promise<void> {
  const llmConfig = runtime.getLlmConfig()
  const searchApiConfig = runtime.getSearchApiConfig()

  if (searchApiConfig.provider === "none" || !searchApiConfig.apiKey) return

  console.log(`[recurring-research] running task: ${recurring.topic}`)

  const taskId = queueResearch(
    projectPath,
    recurring.topic,
    llmConfig,
    searchApiConfig,
    recurring.searchQueries,
  )

  await waitForTaskCompletion(taskId, runtime)

  const task = runtime.getResearchTask(taskId)
  if (!task || task.status !== "done" || !task.synthesis) return

  const previousSummary = recurring.lastResultSummary
  const newSummary = task.synthesis.slice(0, 500)
  runtime.updateRecurringTaskLastRun(recurring.id, newSummary)

  if (!previousSummary) return

  try {
    const hasDiff = await detectSignificantDifference(
      llmConfig,
      recurring.topic,
      previousSummary,
      newSummary,
    )
    if (!hasDiff) return

    runtime.addReviewItems([buildRecurringResearchReviewItem(recurring)])
    console.log(`[recurring-research] significant diff detected for: ${recurring.topic}`)
  } catch (err) {
    console.warn("[recurring-research] diff comparison failed:", err)
  }
}
