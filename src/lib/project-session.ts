import { listDirectory } from "@/commands/fs"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { loadChatHistory, loadReviewItems } from "@/lib/persist"
import {
  getRecentProjects,
  hasSeenOnboarding,
  loadOutputLanguage,
  loadScheduledImportConfig,
  loadSourceWatchConfig,
  markOnboardingSeen,
  saveLastProject,
  saveScheduledImportConfig,
} from "@/lib/project-store"
import { resetProjectState } from "@/lib/reset-project-state"
import { setCurrentClipProject, syncClipProjects } from "@/lib/clip-server"
import type { FileNode, WikiProject } from "@/types/wiki"

interface SessionUiCallbacks {
  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setActiveView: (view: "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "settings") => void
  setShowOnboarding: (visible: boolean) => void
}

export async function openProjectSession(
  project: WikiProject,
  ui: SessionUiCallbacks,
): Promise<void> {
  await resetProjectState()

  ui.setProject(project)

  if (!(await hasSeenOnboarding())) {
    ui.setShowOnboarding(true)
    await markOnboardingSeen()
  }

  const store = useWikiStore.getState()
  const projectOutputLanguage = await loadOutputLanguage(project.id)
  store.setOutputLanguage(projectOutputLanguage ?? "auto")
  ui.setSelectedFile(null)
  ui.setActiveView("wiki")
  store.bumpDataVersion()
  await store.loadProjectSearchHistory(project.path)
  await store.loadProjectSearchFeedback(project.path)
  await saveLastProject(project)

  try {
    const { restoreQueue } = await import("@/lib/ingest-queue")
    await restoreQueue(project.id, project.path)
  } catch (error) {
    console.error("Failed to restore ingest queue:", error)
  }

  import("@/lib/dedup-queue").then(({ restoreQueue }) => {
    restoreQueue(project.id, project.path).catch((error) =>
      console.error("Failed to restore dedup queue:", error),
    )
  })

  try {
    const savedScheduledImport = await loadScheduledImportConfig(project.path)
    if (savedScheduledImport) {
      let path = savedScheduledImport.path
      if (path && !path.startsWith("/") && !path.match(/^[a-zA-Z]:[/\\]/)) {
        path = `${project.path}/${path}`
      }
      store.setScheduledImportConfig({
        ...savedScheduledImport,
        path,
      })
    } else {
      store.setScheduledImportConfig({
        enabled: false,
        path: `${project.path}/raw/sources`,
        interval: 60,
        lastScan: null,
      })
    }
  } catch (error) {
    console.warn("[source watch config load failed]", error)
  }

  const scheduledImportConfig = useWikiStore.getState().scheduledImportConfig
  if (scheduledImportConfig.enabled && scheduledImportConfig.path && scheduledImportConfig.interval > 0) {
    import("@/lib/scheduled-import")
      .then(({ startScheduledImport }) => {
        startScheduledImport(project, scheduledImportConfig)
      })
      .catch((error) => console.error("Failed to start scheduled import:", error))
  }

  import("@/lib/project-file-sync")
    .then(async ({ startProjectFileSync, stopProjectFileSync }) => {
      const config = await loadSourceWatchConfig(project.id)
      useWikiStore.getState().setSourceWatchConfig(config)
      if (config.enabled) {
        startProjectFileSync(project, config).catch((error) =>
          console.error("Failed to start project file sync:", error),
        )
      } else {
        stopProjectFileSync().catch(() => {})
      }
    })
    .catch((error) => console.error("Failed to configure project file sync:", error))

  import("@/lib/wiki-health")
    .then(({ startHealthChecks }) => {
      startHealthChecks(project.path)
    })
    .catch((error) => console.error("Failed to start health checks:", error))

  import("@/lib/recurring-research")
    .then(({ startRecurringResearch }) => {
      startRecurringResearch(project.path)
    })
    .catch((error) => console.error("Failed to start recurring research:", error))

  setCurrentClipProject(project.path).catch(() => {})
  syncClipProjects(await getRecentProjects()).catch(() => {})

  try {
    const tree = await listDirectory(project.path)
    ui.setFileTree(tree)
  } catch (error) {
    console.error("Failed to load file tree:", error)
  }

  try {
    const savedReview = await loadReviewItems(project.path)
    if (savedReview.length > 0) {
      useReviewStore.getState().setItems(savedReview)
    }
  } catch (error) {
    console.warn("[review items load failed]", error)
  }

  try {
    const savedChat = await loadChatHistory(project.path)
    if (savedChat.conversations.length > 0) {
      useChatStore.getState().setConversations(savedChat.conversations)
      useChatStore.getState().setMessages(savedChat.messages)
      const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
      if (sorted[0]) {
        useChatStore.getState().setActiveConversation(sorted[0].id)
      }
    }
  } catch (error) {
    console.warn("[chat history load failed]", error)
  }
}

export async function closeProjectSession(ui: Pick<SessionUiCallbacks, "setProject" | "setFileTree" | "setSelectedFile">): Promise<void> {
  import("@/lib/scheduled-import")
    .then(({ stopScheduledImport }) => {
      stopScheduledImport()
    })
    .catch(() => {})

  import("@/lib/wiki-health")
    .then(({ stopHealthChecks }) => {
      stopHealthChecks()
    })
    .catch(() => {})

  import("@/lib/recurring-research")
    .then(({ stopRecurringResearch }) => {
      stopRecurringResearch()
    })
    .catch(() => {})

  const currentProject = useWikiStore.getState().project
  if (currentProject) {
    const currentConfig = useWikiStore.getState().scheduledImportConfig
    saveScheduledImportConfig(currentProject.path, currentConfig).catch(() => {})
  }

  await resetProjectState()
  ui.setProject(null)
  ui.setFileTree([])
  ui.setSelectedFile(null)
}
