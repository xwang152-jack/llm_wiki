export type CustomApiMode = "chat_completions" | "anthropic_messages"

export type ReasoningMode = "auto" | "off" | "low" | "medium" | "high" | "max" | "custom"

export interface ReasoningConfig {
  mode: ReasoningMode
  budgetTokens?: number
}

export interface LlmConfig {
  provider: "openai" | "anthropic" | "google" | "azure" | "ollama" | "custom" | "minimax" | "claude-code" | "codex-cli"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  maxContextSize: number
  apiMode?: CustomApiMode
  reasoning?: ReasoningConfig
}

export type AzureModelFamily = "auto" | "gpt5"

export type SearchProvider = "tavily" | "serpapi" | "searxng" | "none"

export type SerpApiEngine =
  | "google"
  | "google_news"
  | "google_scholar"
  | "google_patents"
  | "bing"
  | "duckduckgo"
  | "google_images"
  | "google_videos"
  | "youtube"
  | string

export type SearXngCategory =
  | "general"
  | "news"
  | "science"
  | "it"
  | "images"
  | "videos"
  | "files"
  | "map"
  | "music"
  | "social media"
  | string

export interface SearchProviderOverride {
  apiKey?: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
}

export type SearchProviderConfigs = Partial<
  Record<Exclude<SearchProvider, "none">, SearchProviderOverride>
>

export interface SearchApiConfig {
  provider: SearchProvider
  apiKey: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
  providerConfigs?: SearchProviderConfigs
}

export interface EmbeddingConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
  outputDimensionality?: number
  maxChunkChars?: number
  overlapChunkChars?: number
}

export interface ProxyConfig {
  enabled: boolean
  url: string
  bypassLocal: boolean
}

export interface ScheduledImportConfig {
  enabled: boolean
  path: string
  interval: number
  lastScan: number | null
}

export interface ApiConfig {
  enabled: boolean
  allowUnauthenticated: boolean
  token: string
}

export interface SourceWatchConfig {
  enabled: boolean
  autoIngest: boolean
  includeExtensions: string[]
  excludeExtensions: string[]
  excludeDirs: string[]
  excludeGlobs: string[]
  maxFileSizeMb: number
}

export interface MultimodalConfig {
  enabled: boolean
  useMainLlm: boolean
  provider: LlmConfig["provider"]
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  apiMode?: CustomApiMode
  concurrency: number
}

export type OutputLanguage =
  | "auto"
  | "English"
  | "Chinese"
  | "Traditional Chinese"
  | "Japanese"
  | "Korean"
  | "Vietnamese"
  | "French"
  | "German"
  | "Spanish"
  | "Portuguese"
  | "Italian"
  | "Russian"
  | "Arabic"
  | "Persian"
  | "Hindi"
  | "Turkish"
  | "Dutch"
  | "Polish"
  | "Swedish"
  | "Indonesian"
  | "Thai"
  | "Ukrainian"

export interface ProviderOverride {
  apiKey?: string
  model?: string
  baseUrl?: string
  apiMode?: CustomApiMode
  maxContextSize?: number
  reasoning?: ReasoningConfig
}

export type ProviderConfigs = Record<string, ProviderOverride>
