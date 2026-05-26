import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { readFile, listDirectory } from "@/commands/fs"
import {
  rescanProjectFiles,
  startProjectFileWatcher,
  stopProjectFileWatcher,
  type FileSyncPayload,
} from "@/commands/file-sync"
import { defaultFileSyncRuntime, type FileSyncRuntime } from "@/lib/file-sync-runtime"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { WikiProject } from "@/types/wiki"
import type { SourceWatchConfig } from "@/types/config"
import type { FileChangeTask } from "@/commands/file-sync"
import {
  cleanupDeletedWikiPages,
  deleteSourceFiles,
  enqueueSourceIngest,
  isIngestableSourcePath,
} from "@/lib/source-lifecycle"
import { isPathAllowedBySourceWatch, normalizeSourceWatchConfig } from "@/lib/source-watch-config"

let unlistenQueue: UnlistenFn | null = null
let unlistenChanged: UnlistenFn | null = null
let startSeq = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let pendingRefreshPaths = new Set<string>()
let pendingChangeTasks = new Map<string, FileChangeTask>()
let activeSourceWatchConfig = normalizeSourceWatchConfig()
let handledChangeTaskKeys = new Set<string>()

export async function startProjectFileSync(
  project: WikiProject,
  sourceWatchConfig?: SourceWatchConfig,
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): Promise<void> {
  await stopProjectFileSync()
  const seq = ++startSeq
  activeSourceWatchConfig = normalizeSourceWatchConfig(sourceWatchConfig)
  runtime.setRunning(true)
  runtime.setLastError(null)

  unlistenQueue = await listen<FileSyncPayload>("file-sync://queue-updated", (event) => {
    if (event.payload.projectId !== runtime.getCurrentProject()?.id) return
    runtime.setTasks(event.payload.tasks)
  })

  unlistenChanged = await listen<FileSyncPayload>("file-sync://changed", (event) => {
    const current = runtime.getCurrentProject()
    if (!current || event.payload.projectId !== current.id) return
    scheduleRefreshAfterFileChanges(event.payload.tasks, runtime)
  })

  try {
    const result = await startProjectFileWatcher(project.id, normalizePath(project.path), activeSourceWatchConfig)
    if (seq !== startSeq || project.id !== runtime.getCurrentProject()?.id) return
    const startupChangedTasks = mergeChangeTasks([
      ...result.changedTasks,
      ...pendingChangeTasks.values(),
    ].filter((task) => task.projectId === project.id))
      .filter((task) => !handledChangeTaskKeys.has(changeTaskKey(task)))
    pendingRefreshPaths.clear()
    pendingChangeTasks.clear()
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    runtime.setTasks(result.queue.tasks)
    if (startupChangedTasks.length > 0) {
      const paths = [...new Set(startupChangedTasks.map((task) => task.path))]
      await processFileChangeBatch(project, paths, startupChangedTasks, runtime)
    }
  } catch (err) {
    unlistenQueue?.()
    unlistenChanged?.()
    unlistenQueue = null
    unlistenChanged = null
    runtime.setLastError(String(err))
    throw err
  } finally {
    if (seq === startSeq) {
      runtime.setRunning(false)
    }
  }
}

export async function stopProjectFileSync(runtime: FileSyncRuntime = defaultFileSyncRuntime): Promise<void> {
  startSeq++
  unlistenQueue?.()
  unlistenChanged?.()
  unlistenQueue = null
  unlistenChanged = null
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  pendingRefreshPaths.clear()
  pendingChangeTasks.clear()
  handledChangeTaskKeys.clear()
  runtime.clear()
  try {
    await stopProjectFileWatcher()
  } catch {
    // App startup/project switching should not fail just because a stale
    // watcher has already been dropped by the backend.
  }
}

export async function rescanProjectFileSync(
  project: WikiProject,
  sourceWatchConfig?: SourceWatchConfig,
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): Promise<void> {
  const config = normalizeSourceWatchConfig(sourceWatchConfig ?? runtime.getSourceWatchConfig())
  activeSourceWatchConfig = config

  const result = await rescanProjectFiles(project.id, normalizePath(project.path), config)
  if (runtime.getCurrentProject()?.id !== project.id) return
  runtime.setTasks(result.queue.tasks)

  if (runtime.getCurrentProject()?.id !== project.id) return
  if (result.changedTasks.length > 0) {
    const paths = [...new Set(result.changedTasks.map((task) => task.path))]
    await processFileChangeBatch(project, paths, result.changedTasks, runtime)
  } else {
    await refreshAfterFileChanges(project, [], runtime)
  }
}

function scheduleRefreshAfterFileChanges(
  tasks: FileChangeTask[],
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): void {
  for (const task of tasks) {
    pendingRefreshPaths.add(task.path)
    pendingChangeTasks.set(task.path, task)
  }
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    const project = runtime.getCurrentProject()
    if (!project) {
      pendingRefreshPaths.clear()
      pendingChangeTasks.clear()
      return
    }
    const tasks = mergeChangeTasks([...pendingChangeTasks.values()])
      .filter((task) => !handledChangeTaskKeys.has(changeTaskKey(task)))
    const paths = tasks.length > 0
      ? [...new Set(tasks.map((task) => task.path))]
      : [...pendingRefreshPaths]
    pendingRefreshPaths.clear()
    pendingChangeTasks.clear()
    void processFileChangeBatch(project, paths, tasks, runtime)
  }, 250)
}

function mergeChangeTasks(tasks: FileChangeTask[]): FileChangeTask[] {
  const byKey = new Map<string, FileChangeTask>()
  for (const task of tasks) {
    byKey.set(changeTaskKey(task), task)
  }
  return [...byKey.values()]
}

function changeTaskKey(task: FileChangeTask): string {
  const version = task.updatedAt ?? task.createdAt ?? 0
  return task.id
    ? `${task.id}:${version}`
    : `${task.projectId}:${task.path}:${task.kind}:${version}`
}

async function processFileChangeBatch(
  project: WikiProject,
  paths: string[],
  tasks: FileChangeTask[],
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): Promise<void> {
  for (const task of tasks) {
    handledChangeTaskKeys.add(changeTaskKey(task))
  }
  if (handledChangeTaskKeys.size > 4096) {
    handledChangeTaskKeys = new Set([...handledChangeTaskKeys].slice(-2048))
  }
  await cleanupDeletedFiles(project, tasks)
  await enqueueRawSourceChanges(project, tasks, runtime)
  await refreshAfterFileChanges(project, paths, runtime)
}

async function refreshAfterFileChanges(
  project: WikiProject,
  relativePaths: string[],
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): Promise<void> {
  const pp = normalizePath(project.path)
  try {
    const tree = await listDirectory(pp)
    runtime.setProjectTree(tree)
  } catch (err) {
    console.warn("[file-sync] failed to refresh file tree:", err)
  }

  runtime.bumpProjectDataVersion()

  const selectedPath = runtime.getSelectedFile()
  const selected = selectedPath ? normalizePath(selectedPath) : null
  if (!selected) return

  const selectedRel = selected.startsWith(`${pp}/`) ? selected.slice(pp.length + 1) : selected
  if (!relativePaths.includes(selectedRel)) return

  try {
    const content = await readFile(selected)
    runtime.setFileContent(content)
  } catch {
    runtime.setSelectedFile(null)
    runtime.setFileContent("")
  }
}

async function enqueueRawSourceChanges(
  project: WikiProject,
  tasks: FileChangeTask[],
  runtime: FileSyncRuntime = defaultFileSyncRuntime,
): Promise<void> {
  const config = normalizeSourceWatchConfig(activeSourceWatchConfig)
  if (!config.enabled || !config.autoIngest) return

  const candidates = tasks
    .filter((task) => task.projectId === project.id)
    .filter((task) => task.kind === "created" || task.kind === "modified")
    .map((task) => task.path)
    .filter(isIngestableRawSource)

  const paths = candidates.filter((rel) => isPathAllowedBySourceWatch(rel, config))

  if (paths.length === 0) return

  try {
    await enqueueSourceIngest(project, paths, runtime.getLlmConfig())
  } catch (err) {
    console.error("[file-sync] failed to enqueue raw source ingest:", err)
  }
}

function isIngestableRawSource(relativePath: string): boolean {
  const path = normalizePath(relativePath)
  if (!path.startsWith("raw/sources/")) return false
  return isIngestableSourcePath(path)
}

async function cleanupDeletedFiles(project: WikiProject, tasks: FileChangeTask[]): Promise<void> {
  const deleted = tasks
    .filter((task) => task.projectId === project.id && task.kind === "deleted")
    .map((task) => normalizePath(task.path))

  if (deleted.length === 0) return

  const rawSources = deleted.filter(isRawSourcePathForCascade)
  const wikiPages = deleted.filter(isWikiPageForCascade)

  let deletedWikiSlugs = new Set<string>()
  if (rawSources.length > 0) {
    try {
      const result = await deleteSourceFiles(project.path, rawSources, {
        fileAlreadyDeleted: true,
        logReason: rawSources.length === 1 ? "external delete" : "external batch delete",
      })
      deletedWikiSlugs = new Set(result.deletedWikiPaths.map((path) => getFileStem(path)))
    } catch (err) {
      console.error("[file-sync] failed to clean deleted raw sources:", err)
    }
  }

  const wikiPagesToClean = wikiPages.filter((path) => !deletedWikiSlugs.has(getFileStem(path)))
  if (wikiPagesToClean.length > 0) {
    try {
      await cleanupDeletedWikiPages(project.path, wikiPagesToClean)
    } catch (err) {
      console.error("[file-sync] failed to clean deleted wiki pages:", err)
    }
  }
}

function isRawSourcePathForCascade(relativePath: string): boolean {
  const path = normalizePath(relativePath)
  if (!path.startsWith("raw/sources/")) return false
  if (path.includes("/.cache/")) return false
  const fileName = path.split("/").pop() ?? ""
  return Boolean(fileName && !fileName.startsWith("."))
}

function isWikiPageForCascade(relativePath: string): boolean {
  const path = normalizePath(relativePath)
  const lower = path.toLowerCase()
  if (!lower.startsWith("wiki/") || !lower.endsWith(".md")) return false
  const name = lower.split("/").pop()
  if (name === "index.md" || name === "log.md" || name === "overview.md") {
    return false
  }
  return !lower.startsWith("wiki/media/")
}
