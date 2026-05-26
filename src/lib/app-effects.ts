import { setupAutoSave } from "@/lib/auto-save"
import { startClipWatcher } from "@/lib/clip-watcher"

export function initializePersistentAppServices(): void {
  setupAutoSave()
  startClipWatcher()
}

export function installDevUpdateBannerTestHook(): void {
  if (!import.meta.env.DEV) return

  void (async () => {
    const storeMod = await import("@/stores/update-store")
    const { useUpdateStore } = storeMod

    ;(window as unknown as { __llmwiki_updateStore?: typeof useUpdateStore }).__llmwiki_updateStore =
      useUpdateStore
    ;(window as unknown as { __llmwiki_testUpdateBanner?: (clear?: boolean) => void }).__llmwiki_testUpdateBanner =
      (clear = false) => {
        if (clear) {
          useUpdateStore.getState().setResult(
            { kind: "up-to-date", local: __APP_VERSION__, remote: __APP_VERSION__ },
            Date.now(),
          )
          useUpdateStore.getState().setDismissed(null)
          console.log("[test] update banner cleared")
          return
        }
        useUpdateStore.getState().setResult(
          {
            kind: "available",
            local: __APP_VERSION__,
            remote: "v999.0.0",
            release: {
              name: "v999.0.0 (test)",
              tag_name: "v999.0.0",
              body:
                "Test release for banner-UX verification.\n\n" +
                "- Bigger red dot on the Settings icon\n" +
                "- Top banner with one-click dismiss\n" +
                "- Once dismissed, won't reappear for this version",
              html_url: "https://github.com/nashsu/llm_wiki/releases",
              published_at: new Date().toISOString(),
            },
          },
          Date.now(),
        )
        useUpdateStore.getState().setDismissed(null)
        console.log(
          "[test] update banner injected. Run __llmwiki_testUpdateBanner(true) to clear.",
        )
      }
  })()
}

export function scheduleBackgroundUpdateCheck(): () => void {
  let cancelled = false

  const timer = window.setTimeout(async () => {
    if (cancelled) return

    try {
      const { loadUpdateCheckState, saveUpdateCheckState } = await import("@/lib/project-store")
      const { useUpdateStore } = await import("@/stores/update-store")
      const { checkForUpdates, UPDATE_CHECK_CACHE_MS } = await import("@/lib/update-check")

      const persisted = await loadUpdateCheckState()
      if (persisted) useUpdateStore.getState().hydrate(persisted)

      const state = useUpdateStore.getState()
      if (!state.enabled) {
        console.log("[update-check] skipped: user disabled auto-check in settings")
        return
      }

      const now = Date.now()
      const fresh =
        state.lastCheckedAt !== null &&
        state.lastResult !== null &&
        now - state.lastCheckedAt < UPDATE_CHECK_CACHE_MS
      if (fresh) {
        const ageMin = Math.round((now - (state.lastCheckedAt ?? 0)) / 60_000)
        console.log(
          `[update-check] skipped: cache hit (last check ${ageMin} min ago, ` +
            `cache window ${UPDATE_CHECK_CACHE_MS / 60_000} min). ` +
            `Last result: kind=${state.lastResult?.kind ?? "none"}`,
        )
        return
      }

      useUpdateStore.getState().setChecking(true)
      console.log(`[update-check] fetching GitHub releases (local=${__APP_VERSION__})`)
      const result = await checkForUpdates({
        currentVersion: __APP_VERSION__,
        repo: "nashsu/llm_wiki",
      })
      if (cancelled) return

      useUpdateStore.getState().setResult(result, Date.now())
      if (result.kind === "available") {
        console.log(
          `[update-check] update available: local=${result.local} → remote=${result.remote}`,
        )
      } else if (result.kind === "up-to-date") {
        console.log(
          `[update-check] up to date: local=${result.local}, remote latest=${result.remote}`,
        )
      } else {
        console.log(`[update-check] error: ${result.message}`)
      }

      await saveUpdateCheckState({
        enabled: useUpdateStore.getState().enabled,
        lastCheckedAt: Date.now(),
        dismissedVersion: useUpdateStore.getState().dismissedVersion,
      })
    } catch (error) {
      console.warn("[update check failed]", error)
    }
  }, 1500)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
