import { useState, useEffect } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  initializePersistentAppServices,
  installDevUpdateBannerTestHook,
  scheduleBackgroundUpdateCheck,
} from "@/lib/app-effects"
import { initializeApp } from "@/lib/app-bootstrap"
import {
  openProjectDirectorySelection,
  openRecentProjectSelection,
} from "@/lib/project-open-flow"
import { closeProjectSession, openProjectSession } from "@/lib/project-session"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { OnboardingGuide } from "@/components/onboarding/onboarding-guide"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    initializePersistentAppServices()
  }, [])

  // Dev-only helper for visually testing the update-banner UX.
  // Open dev tools and run:
  //   __llmwiki_testUpdateBanner()
  // to inject a fake "available" result into the update store —
  // banner appears at the top + red dot lights up the gear icon.
  // Run again with arg `false` (or call setDismissed via the store)
  // to clear. Gated on `import.meta.env.DEV` so the helper never
  // ships in production builds.
  useEffect(() => {
    installDevUpdateBannerTestHook()
  }, [])

  // Background update check — hydrate persisted user preferences, then
  // hit GitHub at most once every UPDATE_CHECK_CACHE_MS. Runs 1.5 s
  // after mount so it doesn't contend with the heaviest startup work
  // (project load, file tree, vector store init) but still surfaces
  // a new release in time for the user to notice it during their
  // first interaction. Silent on failure; the UI in Settings → About
  // lets the user retry manually.
  useEffect(() => {
    return scheduleBackgroundUpdateCheck()
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        await initializeApp(handleProjectOpened)
      } catch (error) {
        console.warn("[app init failed]", error)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    await openProjectSession(proj, {
      setProject,
      setFileTree,
      setSelectedFile,
      setActiveView,
      setShowOnboarding,
    })
  }

  async function handleSelectRecent(proj: WikiProject) {
    await openRecentProjectSelection(proj, handleProjectOpened)
  }

  async function handleOpenProject() {
    await openProjectDirectorySelection(handleProjectOpened)
  }

  async function handleSwitchProject() {
    await closeProjectSession({
      setProject,
      setFileTree,
      setSelectedFile,
    })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
      <OnboardingGuide open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </>
  )
}

export default App
