import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/types/config"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

import { streamChat } from "./llm-client"
import {
  buildActiveConversationMessages,
  compressActiveConversationHistory,
} from "./chat-history-coordinator"

const mockStreamChat = vi.mocked(streamChat)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

beforeEach(() => {
  mockStreamChat.mockReset()
})

describe("buildActiveConversationMessages", () => {
  it("prepends a synthetic summary message when summary exists", () => {
    const messages = buildActiveConversationMessages({
      messages: [
        {
          id: "m1",
          role: "user",
          content: "old",
          timestamp: 1,
          conversationId: "c1",
        },
        {
          id: "m2",
          role: "assistant",
          content: "recent",
          timestamp: 2,
          conversationId: "c1",
        },
      ],
      activeConversationId: "c1",
      maxHistoryMessages: 1,
      conversationSummaries: { c1: "summary text" },
    })

    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe("__summary__")
    expect(messages[0].content).toContain("summary text")
    expect(messages[1].id).toBe("m2")
  })
})

describe("compressActiveConversationHistory", () => {
  it("summarizes only when history exceeds threshold", async () => {
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("compressed summary")
      callbacks.onDone()
    })

    const setConversationSummary = vi.fn()

    await compressActiveConversationHistory({
      messages: [
        { id: "1", role: "user", content: "a", timestamp: 1, conversationId: "c1" },
        { id: "2", role: "assistant", content: "b", timestamp: 2, conversationId: "c1" },
        { id: "3", role: "user", content: "c", timestamp: 3, conversationId: "c1" },
        { id: "4", role: "assistant", content: "d", timestamp: 4, conversationId: "c1" },
        { id: "5", role: "user", content: "e", timestamp: 5, conversationId: "c1" },
      ],
      activeConversationId: "c1",
      maxHistoryMessages: 2,
      llmConfig: fakeLlmConfig(),
      setConversationSummary,
    })

    expect(mockStreamChat).toHaveBeenCalledOnce()
    expect(setConversationSummary).toHaveBeenCalledWith("c1", "compressed summary")
  })
})
