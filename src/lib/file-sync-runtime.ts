import { useFileSyncStore } from "@/stores/file-sync-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig, SourceWatchConfig } from "@/types/config"
import type { WikiProject, FileNode } from "@/types/wiki"
import type { FileChangeTask } from "@/commands/file-sync"

export interface FileSyncRuntime {
  getCurrentProject: () => WikiProject | null
  getSourceWatchConfig: () => SourceWatchConfig
  getLlmConfig: () => LlmConfig
  getSelectedFile: () => string | null
  setProjectTree: (tree: FileNode[]) => void
  bumpProjectDataVersion: () => void
  setSelectedFile: (path: string | null) => void
  setFileContent: (content: string) => void
  setTasks: (tasks: FileChangeTask[]) => void
  setRunning: (running: boolean) => void
  setLastError: (error: string | null) => void
  clear: () => void
}

export const defaultFileSyncRuntime: FileSyncRuntime = {
  getCurrentProject: () => useWikiStore.getState().project,
  getSourceWatchConfig: () => useWikiStore.getState().sourceWatchConfig,
  getLlmConfig: () => useWikiStore.getState().llmConfig,
  getSelectedFile: () => useWikiStore.getState().selectedFile,
  setProjectTree: (tree) => useWikiStore.getState().setFileTree(tree),
  bumpProjectDataVersion: () => useWikiStore.getState().bumpDataVersion(),
  setSelectedFile: (path) => useWikiStore.getState().setSelectedFile(path),
  setFileContent: (content) => useWikiStore.getState().setFileContent(content),
  setTasks: (tasks) => useFileSyncStore.getState().setTasks(tasks),
  setRunning: (running) => useFileSyncStore.getState().setRunning(running),
  setLastError: (error) => useFileSyncStore.getState().setLastError(error),
  clear: () => useFileSyncStore.getState().clear(),
}
