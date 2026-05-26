import { useRef, useEffect, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import { useChatStore, chatMessagesToLLM } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { buildChatRetrievalContext, composeChatRequestMessages } from "@/lib/chat-retrieval-coordinator"
import {
  buildActiveConversationMessages,
  compressActiveConversationHistory,
} from "@/lib/chat-history-coordinator"

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function ConversationSidebar() {
  const { t } = useTranslation()
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  return (
    <div className="flex h-full w-[200px] flex-shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => createConversation()}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("chat.newChat")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t("chat.noConversationsYet")}
          </p>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <div
                key={conv.id}
                className={`group relative mx-1 my-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 flex-1 text-xs font-medium leading-snug">
                    {conv.title}
                  </span>
                  {hoveredId === conv.id && (
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(conv.id)
                        // Delete persisted chat file
                        const proj = useWikiStore.getState().project
                        if (proj) {
                          deleteFile(`${proj.path}/.llm-wiki/chats/${conv.id}.json`).catch(() => {})
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{formatDate(conv.updatedAt)}</span>
                  {msgCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{msgCount} {t("chat.msgCount")}</span>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const { t } = useTranslation()
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)

  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const conversationSummaries = useChatStore((s) => s.conversationSummaries)
  const setConversationSummary = useChatStore((s) => s.setConversationSummary)
  const activeMessages = buildActiveConversationMessages({
    messages: allMessages,
    activeConversationId,
    maxHistoryMessages,
    conversationSummaries,
  })

  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const activePromptTemplate = useWikiStore((s) => s.activePromptTemplate)
  const customPromptTemplates = useWikiStore((s) => s.customPromptTemplates)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [activeMessages, streamingContent])

  const handleSend = useCallback(
    async (text: string) => {
      // Auto-create a conversation if none is active
      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      addMessage("user", text)
      setStreaming(true)

      const {
        systemMessages,
        queryRefs,
        langReminder,
        lastQueryPages,
      } = await buildChatRetrievalContext({
        project,
        text,
        llmConfig,
        dataVersion,
        activePromptTemplate,
        customPromptTemplates,
      })
      useChatStore.getState().setLastQueryPages(lastQueryPages)

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = buildActiveConversationMessages({
        messages: useChatStore.getState().messages,
        activeConversationId: useChatStore.getState().activeConversationId,
        maxHistoryMessages: useChatStore.getState().maxHistoryMessages,
        conversationSummaries: useChatStore.getState().conversationSummaries,
      })
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      // Prepend the language reminder onto the final user turn rather than
      // inserting a second {role:"system"} between history and the final
      // user message. vLLM / llama.cpp / Ollama drive their chat templates
      // from HF Jinja, and Qwen3-family templates enforce "system only at
      // index 0" — a mid-conversation system message gets rejected with
      // "System message must be at the beginning." (HTTP 400). OpenAI and
      // Anthropic are more lenient, but keeping a single system at the top
      // is the safest shape across every OpenAI-compatible backend.
      const historyMessages = chatMessagesToLLM(activeConvMessages)
      const llmMessages = composeChatRequestMessages(systemMessages, historyMessages, langReminder)

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""
      let thinkingOpen = false

      const appendReasoning = (token: string) => {
        if (!token) return
        if (!thinkingOpen) {
          thinkingOpen = true
          accumulated += "<think>"
          appendStreamToken("<think>")
        }
        accumulated += token
        appendStreamToken(token)
      }

      const closeReasoning = () => {
        if (!thinkingOpen) return
        thinkingOpen = false
        accumulated += "</think>"
        appendStreamToken("</think>")
      }

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            closeReasoning()
            accumulated += token
            appendStreamToken(token)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            closeReasoning()
            finalizeStream(accumulated, queryRefs)
            abortRef.current = null
            void compressActiveConversationHistory({
              messages: useChatStore.getState().messages,
              activeConversationId: useChatStore.getState().activeConversationId,
              maxHistoryMessages: useChatStore.getState().maxHistoryMessages,
              llmConfig,
              setConversationSummary,
            })
          },
          onError: (err) => {
            finalizeStream(`Error: ${err.message}`, undefined)
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [
      project,
      llmConfig,
      dataVersion,
      activePromptTemplate,
      customPromptTemplates,
      conversationSummaries,
      addMessage,
      setStreaming,
      appendStreamToken,
      finalizeStream,
      createConversation,
      maxHistoryMessages,
      setConversationSummary,
    ],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = buildActiveConversationMessages({
      messages: useChatStore.getState().messages,
      activeConversationId: useChatStore.getState().activeConversationId,
      maxHistoryMessages: useChatStore.getState().maxHistoryMessages,
      conversationSummaries: useChatStore.getState().conversationSummaries,
    })
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Zustand set() is synchronous — no delay needed
    const store = useChatStore.getState()
    const updatedActive = buildActiveConversationMessages({
      messages: store.messages,
      activeConversationId: store.activeConversationId,
      maxHistoryMessages: store.maxHistoryMessages,
      conversationSummaries: store.conversationSummaries,
    })
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(pp)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to write to wiki:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-row overflow-hidden">
      <ConversationSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">{t("chat.startNewConversation")}</p>
              <p className="mt-1 text-xs opacity-60">{t("chat.clickNewChatToBegin")}</p>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-3 py-2"
            >
              <div className="flex flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  // Check if this is the last assistant message
                  const isLastAssistant = msg.role === "assistant" &&
                    !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant && !isStreaming}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                    />
                  )
                })}
                {isStreaming && <StreamingMessage content={streamingContent} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  {t("chat.writeToWiki")}
                </Button>
              </div>
            )}
          </>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          placeholder={
            mode === "ingest"
              ? t("chat.ingestPlaceholder")
              : t("chat.typeAMessage")
          }
        />
      </div>
    </div>
  )
}
