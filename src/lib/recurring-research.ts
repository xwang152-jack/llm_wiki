import {
  executeRecurringResearchTask,
} from "@/lib/recurring-research-coordinator"
import {
  defaultRecurringResearchRuntime,
  type RecurringResearchRuntime,
} from "@/lib/recurring-research-runtime"

/** How often the scheduler wakes up to check for due tasks (1 hour). */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

let timerHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the recurring-research scheduler for the given project.
 * Safe to call multiple times — calling again simply resets the timer.
 */
export function startRecurringResearch(
  projectPath: string,
  runtime: RecurringResearchRuntime = defaultRecurringResearchRuntime,
): void {
  stopRecurringResearch()
  console.log("[recurring-research] scheduler started")

  // Run the first check immediately, then on the interval.
  tick(projectPath, runtime).catch((err) =>
    console.warn("[recurring-research] initial tick failed:", err),
  )

  timerHandle = setInterval(() => {
    tick(projectPath, runtime).catch((err) =>
      console.warn("[recurring-research] tick failed:", err),
    )
  }, CHECK_INTERVAL_MS)
}

/** Stop the recurring-research scheduler. */
export function stopRecurringResearch(): void {
  if (timerHandle !== null) {
    clearInterval(timerHandle)
    timerHandle = null
    console.log("[recurring-research] scheduler stopped")
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function tick(
  projectPath: string,
  runtime: RecurringResearchRuntime = defaultRecurringResearchRuntime,
): Promise<void> {
  const recurringTasks = runtime.getRecurringTasks()
  const now = Date.now()

  for (const task of recurringTasks) {
    if (!task.enabled) continue

    const lastRun = task.lastRunAt ?? 0
    if (now - lastRun < task.intervalMs) continue

    await executeRecurringTask(projectPath, task, runtime)
  }
}

async function executeRecurringTask(
  projectPath: string,
  recurring: import("@/stores/research-store").RecurringResearchTask,
  runtime: RecurringResearchRuntime = defaultRecurringResearchRuntime,
): Promise<void> {
  await executeRecurringResearchTask(projectPath, recurring, runtime)
}
