import type { ApiConfig, ProxyConfig, SourceWatchConfig } from "@/types/config"
import { normalizeSourceWatchConfig } from "@/lib/source-watch-config"

export const APP_STATE_FILE_NAME = "app-state.json"
export const APP_STATE_SCHEMA_VERSION = 1

export const APP_STATE_KEYS = {
  schemaVersion: "schemaVersion",
  proxyConfig: "proxyConfig",
  apiConfig: "apiConfig",
  projectRegistry: "projectRegistry",
  sourceWatchConfig: "sourceWatchConfig",
  recentProjects: "recentProjects",
  lastProject: "lastProject",
  onboardingSeen: "onboardingSeen",
} as const

export interface ProjectRegistryEntry {
  id: string
  path: string
  name: string
  lastOpened: number
}

export type ProjectRegistry = Record<string, ProjectRegistryEntry>

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  url: "",
  bypassLocal: true,
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  enabled: true,
  allowUnauthenticated: false,
  token: "",
}

export interface AppStateMigrationHealth {
  schemaVersion: number
  migrated: boolean
  migratedKeys: string[]
  warnings: string[]
}

interface StoreLike {
  get<T>(key: string): Promise<T | null | undefined>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeProxyConfigValue(value: unknown): ProxyConfig | null {
  if (!isRecord(value)) {
    return null
  }
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_PROXY_CONFIG.enabled,
    url: typeof value.url === "string" ? value.url : DEFAULT_PROXY_CONFIG.url,
    bypassLocal:
      typeof value.bypassLocal === "boolean"
        ? value.bypassLocal
        : DEFAULT_PROXY_CONFIG.bypassLocal,
  }
}

export function normalizeApiConfigValue(value: unknown): ApiConfig | null {
  if (!isRecord(value)) {
    return null
  }
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_API_CONFIG.enabled,
    allowUnauthenticated:
      typeof value.allowUnauthenticated === "boolean"
        ? value.allowUnauthenticated
        : DEFAULT_API_CONFIG.allowUnauthenticated,
    token: typeof value.token === "string" ? value.token : DEFAULT_API_CONFIG.token,
  }
}

function normalizeSourceWatchSettingsValue(
  value: unknown,
): Record<string, SourceWatchConfig> | null {
  if (!isRecord(value)) {
    return null
  }
  const normalized: Record<string, SourceWatchConfig> = {}
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeSourceWatchConfig(
      isRecord(entry) ? (entry as Partial<SourceWatchConfig>) : undefined,
    )
  }
  return normalized
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function writeIfChanged(
  store: StoreLike,
  key: string,
  nextValue: unknown,
  currentValue: unknown,
  migratedKeys: string[],
): Promise<boolean> {
  if (sameJson(currentValue, nextValue)) {
    return false
  }
  await store.set(key, nextValue)
  migratedKeys.push(key)
  return true
}

export async function migrateAppStateStore(
  store: StoreLike,
): Promise<AppStateMigrationHealth> {
  const currentVersion = await store.get<number>(APP_STATE_KEYS.schemaVersion)
  const migratedKeys: string[] = []
  const warnings: string[] = []
  let changed = false

  const rawProxyConfig = await store.get<unknown>(APP_STATE_KEYS.proxyConfig)
  if (rawProxyConfig !== undefined && rawProxyConfig !== null) {
    const normalizedProxyConfig = normalizeProxyConfigValue(rawProxyConfig)
    if (normalizedProxyConfig) {
      changed =
        (await writeIfChanged(
          store,
          APP_STATE_KEYS.proxyConfig,
          normalizedProxyConfig,
          rawProxyConfig,
          migratedKeys,
        )) || changed
    } else {
      warnings.push("proxyConfig 不是对象，已保留原值并等待用户修复。")
    }
  }

  const rawApiConfig = await store.get<unknown>(APP_STATE_KEYS.apiConfig)
  if (rawApiConfig !== undefined && rawApiConfig !== null) {
    const normalizedApiConfig = normalizeApiConfigValue(rawApiConfig)
    if (normalizedApiConfig) {
      changed =
        (await writeIfChanged(
          store,
          APP_STATE_KEYS.apiConfig,
          normalizedApiConfig,
          rawApiConfig,
          migratedKeys,
        )) || changed
    } else {
      warnings.push("apiConfig 不是对象，已保留原值并等待用户修复。")
    }
  }

  const rawSourceWatchConfig = await store.get<unknown>(APP_STATE_KEYS.sourceWatchConfig)
  if (rawSourceWatchConfig !== undefined && rawSourceWatchConfig !== null) {
    const normalizedSourceWatchConfig = normalizeSourceWatchSettingsValue(rawSourceWatchConfig)
    if (normalizedSourceWatchConfig) {
      changed =
        (await writeIfChanged(
          store,
          APP_STATE_KEYS.sourceWatchConfig,
          normalizedSourceWatchConfig,
          rawSourceWatchConfig,
          migratedKeys,
        )) || changed
    } else {
      warnings.push("sourceWatchConfig 不是对象，已保留原值并等待用户修复。")
    }
  }

  const rawProjectRegistry = await store.get<unknown>(APP_STATE_KEYS.projectRegistry)
  if (rawProjectRegistry !== undefined && rawProjectRegistry !== null && !isRecord(rawProjectRegistry)) {
    warnings.push("projectRegistry 不是对象，本地 API 项目发现可能不完整。")
  }

  if (currentVersion !== APP_STATE_SCHEMA_VERSION) {
    await store.set(APP_STATE_KEYS.schemaVersion, APP_STATE_SCHEMA_VERSION)
    migratedKeys.push(APP_STATE_KEYS.schemaVersion)
    changed = true
  }

  if (changed) {
    await store.save()
  }

  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    migrated: changed,
    migratedKeys,
    warnings,
  }
}
