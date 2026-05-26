import { beforeEach, describe, expect, it, vi } from "vitest"
import { APP_STATE_KEYS, APP_STATE_SCHEMA_VERSION } from "@/lib/app-state-contract"

const mockStore = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return {
    state,
    get: vi.fn(async (key: string) => state[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      state[key] = value
    }),
    save: vi.fn(async () => {}),
    delete: vi.fn(async (key: string) => {
      delete state[key]
    }),
  }
})

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => mockStore),
}))

describe("project-store app-state contract", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(mockStore.state)) {
      delete mockStore.state[key]
    }
  })

  it("migrates legacy config slices to the current schema", async () => {
    mockStore.state[APP_STATE_KEYS.apiConfig] = {
      enabled: false,
      allowUnauthenticated: "yes",
      token: 123,
    }
    mockStore.state[APP_STATE_KEYS.proxyConfig] = {
      url: "http://proxy.internal:8080",
    }
    mockStore.state[APP_STATE_KEYS.sourceWatchConfig] = {
      default: {
        enabled: true,
        includeExtensions: [".PDF", "pdf", ""],
        excludeDirs: [" tmp ", "tmp"],
        maxFileSizeMb: 0,
      },
    }

    const projectStore = await import("./project-store")
    const health = await projectStore.initializeAppStateStore()
    const apiConfig = await projectStore.loadApiConfig()
    const proxyConfig = await projectStore.loadProxyConfig()
    const sourceWatchConfig = await projectStore.loadSourceWatchConfig()

    expect(health.migrated).toBe(true)
    expect(health.migratedKeys).toEqual(
      expect.arrayContaining([
        APP_STATE_KEYS.schemaVersion,
        APP_STATE_KEYS.apiConfig,
        APP_STATE_KEYS.proxyConfig,
        APP_STATE_KEYS.sourceWatchConfig,
      ]),
    )
    expect(mockStore.state[APP_STATE_KEYS.schemaVersion]).toBe(APP_STATE_SCHEMA_VERSION)
    expect(apiConfig).toEqual({
      enabled: false,
      allowUnauthenticated: false,
      token: "",
    })
    expect(proxyConfig).toEqual({
      enabled: false,
      url: "http://proxy.internal:8080",
      bypassLocal: true,
    })
    expect(sourceWatchConfig).toMatchObject({
      enabled: true,
      includeExtensions: ["pdf"],
      excludeDirs: ["tmp"],
      maxFileSizeMb: 1,
    })
    expect(mockStore.save).toHaveBeenCalledTimes(1)
  })

  it("reports invalid shared registry shapes without overwriting them", async () => {
    mockStore.state[APP_STATE_KEYS.schemaVersion] = APP_STATE_SCHEMA_VERSION
    mockStore.state[APP_STATE_KEYS.projectRegistry] = ["bad-shape"]

    const projectStore = await import("./project-store")
    const health = await projectStore.initializeAppStateStore()
    const registry = await projectStore.loadProjectRegistry()

    expect(health.migrated).toBe(false)
    expect(health.warnings).toContain(
      "projectRegistry 不是对象，本地 API 项目发现可能不完整。",
    )
    expect(registry).toEqual({})
    expect(mockStore.state[APP_STATE_KEYS.projectRegistry]).toEqual(["bad-shape"])
    expect(mockStore.save).not.toHaveBeenCalled()
  })

  it("loads and saves project registry through the shared app-state contract", async () => {
    mockStore.state[APP_STATE_KEYS.schemaVersion] = APP_STATE_SCHEMA_VERSION
    mockStore.state[APP_STATE_KEYS.projectRegistry] = {
      "project-1": {
        id: "project-1",
        path: "/tmp/wiki",
        name: "Wiki",
        lastOpened: 123,
      },
    }

    const projectStore = await import("./project-store")
    expect(await projectStore.loadProjectRegistry()).toEqual({
      "project-1": {
        id: "project-1",
        path: "/tmp/wiki",
        name: "Wiki",
        lastOpened: 123,
      },
    })

    await projectStore.saveProjectRegistry({
      "project-2": {
        id: "project-2",
        path: "/tmp/notes",
        name: "Notes",
        lastOpened: 456,
      },
    })

    expect(mockStore.state[APP_STATE_KEYS.projectRegistry]).toEqual({
      "project-2": {
        id: "project-2",
        path: "/tmp/notes",
        name: "Notes",
        lastOpened: 456,
      },
    })
    expect(mockStore.save).toHaveBeenCalledTimes(1)
  })

  it("persists onboarding as seen after the first display", async () => {
    mockStore.state[APP_STATE_KEYS.schemaVersion] = APP_STATE_SCHEMA_VERSION

    const projectStore = await import("./project-store")

    expect(await projectStore.hasSeenOnboarding()).toBe(false)

    await projectStore.markOnboardingSeen()

    expect(await projectStore.hasSeenOnboarding()).toBe(true)
    expect(mockStore.state[APP_STATE_KEYS.onboardingSeen]).toBe(true)
    expect(mockStore.save).toHaveBeenCalledTimes(1)
  })
})
