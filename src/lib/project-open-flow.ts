import { open } from "@tauri-apps/plugin-dialog"
import { openProject } from "@/commands/fs"
import type { WikiProject } from "@/types/wiki"

type ProjectOpenedHandler = (project: WikiProject) => Promise<void>
type ProjectOpenErrorHandler = (error: unknown) => void

function alertProjectOpenError(error: unknown): void {
  window.alert(`Failed to open project: ${error}`)
}

export async function openRecentProjectSelection(
  project: WikiProject,
  onProjectOpened: ProjectOpenedHandler,
  onError: ProjectOpenErrorHandler = alertProjectOpenError,
): Promise<void> {
  try {
    const validated = await openProject(project.path)
    await onProjectOpened(validated)
  } catch (error) {
    onError(error)
  }
}

export async function openProjectDirectorySelection(
  onProjectOpened: ProjectOpenedHandler,
  onError: ProjectOpenErrorHandler = alertProjectOpenError,
): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Wiki Project",
  })
  if (!selected) return

  try {
    const project = await openProject(selected)
    await onProjectOpened(project)
  } catch (error) {
    onError(error)
  }
}
