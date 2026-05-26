import { useActivityStore, type ActivityItem } from "@/stores/activity-store"
import { useChatStore, type DisplayMessage, type MessageReference } from "@/stores/chat-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { EmbeddingConfig, MultimodalConfig, OutputLanguage } from "@/types/config"
import type { FileNode } from "@/types/wiki"

export interface IngestRuntime {
  addActivityItem: (item: Omit<ActivityItem, "id" | "createdAt">) => string
  updateActivityItem: (
    id: string,
    updates: Partial<Pick<ActivityItem, "status" | "detail" | "filesWritten">>,
  ) => void
  getActivityItem: (id: string) => ActivityItem | undefined
  getMultimodalConfig: () => MultimodalConfig
  getEmbeddingConfig: () => EmbeddingConfig
  getOutputLanguage: () => OutputLanguage
  setProjectTree: (tree: FileNode[]) => void
  bumpProjectDataVersion: () => void
  addReviewItems: (
    items: Omit<ReviewItem, "id" | "resolved" | "createdAt" | "priority">[],
  ) => void
  getChatMessages: () => DisplayMessage[]
  getIngestSource: () => string | null
  setChatMode: (mode: "chat" | "ingest") => void
  setIngestSource: (path: string | null) => void
  clearChatMessages: () => void
  setChatStreaming: (streaming: boolean) => void
  addChatMessage: (role: DisplayMessage["role"], content: string) => void
  appendChatStreamToken: (token: string) => void
  finalizeChatStream: (content: string, references?: MessageReference[]) => void
}

export const defaultIngestRuntime: IngestRuntime = {
  addActivityItem: (item) => useActivityStore.getState().addItem(item),
  updateActivityItem: (id, updates) => useActivityStore.getState().updateItem(id, updates),
  getActivityItem: (id) => useActivityStore.getState().items.find((item) => item.id === id),
  getMultimodalConfig: () => useWikiStore.getState().multimodalConfig,
  getEmbeddingConfig: () => useWikiStore.getState().embeddingConfig,
  getOutputLanguage: () => useWikiStore.getState().outputLanguage,
  setProjectTree: (tree) => useWikiStore.getState().setFileTree(tree),
  bumpProjectDataVersion: () => useWikiStore.getState().bumpDataVersion(),
  addReviewItems: (items) => useReviewStore.getState().addItems(items),
  getChatMessages: () => useChatStore.getState().messages,
  getIngestSource: () => useChatStore.getState().ingestSource,
  setChatMode: (mode) => useChatStore.getState().setMode(mode),
  setIngestSource: (path) => useChatStore.getState().setIngestSource(path),
  clearChatMessages: () => useChatStore.getState().clearMessages(),
  setChatStreaming: (streaming) => useChatStore.getState().setStreaming(streaming),
  addChatMessage: (role, content) => useChatStore.getState().addMessage(role, content),
  appendChatStreamToken: (token) => useChatStore.getState().appendStreamToken(token),
  finalizeChatStream: (content, references) =>
    useChatStore.getState().finalizeStream(content, references),
}
