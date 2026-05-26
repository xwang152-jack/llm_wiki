import { streamChat } from "@/lib/llm-client"
import type { DisplayMessage } from "@/stores/chat-store"
import type { LlmConfig } from "@/types/config"

const summaryCache = new Map<string, { messageCount: number; summary: string }>()

async function summarizeHistory(
  messages: Array<{ role: string; content: string }>,
  llmConfig: LlmConfig,
  conversationId: string,
): Promise<string> {
  const cached = summaryCache.get(conversationId)
  if (cached && cached.messageCount === messages.length) return cached.summary

  const conversationText = messages
    .map((message) => `${message.role}: ${message.content.slice(0, 200)}`)
    .join("\n")

  let summary = ""

  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content:
          "Summarize this conversation in 2-3 sentences, preserving key facts, decisions, and topics discussed. Be concise.",
      },
      { role: "user", content: conversationText },
    ],
    {
      onToken: (token) => {
        summary += token
      },
      onDone: () => {},
      onError: (err) => {
        console.warn("[chat] summary failed:", err.message)
      },
    },
    undefined,
    { temperature: 0, max_tokens: 256 },
  )

  const result = summary || "Previous conversation summarized."
  summaryCache.set(conversationId, { messageCount: messages.length, summary: result })
  return result
}

export interface ActiveConversationMessagesInput {
  messages: DisplayMessage[]
  activeConversationId: string | null
  maxHistoryMessages: number
  conversationSummaries: Record<string, string>
}

export function buildActiveConversationMessages(
  input: ActiveConversationMessagesInput,
): DisplayMessage[] {
  const { messages, activeConversationId, maxHistoryMessages, conversationSummaries } = input
  if (!activeConversationId) return []

  const conversationMessages = messages.filter(
    (message) => message.conversationId === activeConversationId,
  )
  const recentMessages = conversationMessages.slice(-maxHistoryMessages)
  const summary = conversationSummaries[activeConversationId]

  if (summary && conversationMessages.length > maxHistoryMessages) {
    return [
      {
        id: "__summary__",
        role: "system",
        content: `[Previous conversation summary]: ${summary}`,
        timestamp: recentMessages[0]?.timestamp ?? Date.now(),
        conversationId: activeConversationId,
      },
      ...recentMessages,
    ]
  }

  return recentMessages
}

export interface CompressConversationHistoryInput {
  messages: DisplayMessage[]
  activeConversationId: string | null
  maxHistoryMessages: number
  llmConfig: LlmConfig
  setConversationSummary: (conversationId: string, summary: string) => void
}

export async function compressActiveConversationHistory(
  input: CompressConversationHistoryInput,
): Promise<void> {
  const {
    messages,
    activeConversationId,
    maxHistoryMessages,
    llmConfig,
    setConversationSummary,
  } = input
  if (!activeConversationId) return

  const conversationMessages = messages.filter(
    (message) => message.conversationId === activeConversationId,
  )
  if (conversationMessages.length <= maxHistoryMessages * 2) return

  const oldMessages = conversationMessages.slice(0, conversationMessages.length - maxHistoryMessages)

  try {
    const summary = await summarizeHistory(oldMessages, llmConfig, activeConversationId)
    setConversationSummary(activeConversationId, summary)
  } catch {
    // Best-effort - failures are non-fatal.
  }
}
