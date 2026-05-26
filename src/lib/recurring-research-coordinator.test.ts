import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/types/config"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

import { streamChat } from "./llm-client"
import {
  buildRecurringResearchReviewItem,
  detectSignificantDifference,
} from "./recurring-research-coordinator"

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

describe("buildRecurringResearchReviewItem", () => {
  it("builds a suggestion review item with fallback query", () => {
    const item = buildRecurringResearchReviewItem({
      id: "rec-1",
      topic: "Attention scaling",
      intervalMs: 1000,
      lastRunAt: null,
      lastResultSummary: null,
      enabled: true,
    })

    expect(item.type).toBe("suggestion")
    expect(item.title).toBe("Research Update: Attention scaling")
    expect(item.searchQueries).toEqual(["Attention scaling"])
    expect(item.options).toHaveLength(2)
  })
})

describe("detectSignificantDifference", () => {
  it("returns true when the model answers YES", async () => {
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("YES")
      callbacks.onDone()
    })

    await expect(
      detectSignificantDifference(fakeLlmConfig(), "topic", "old", "new"),
    ).resolves.toBe(true)
  })

  it("returns false when the model answers NO", async () => {
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("NO")
      callbacks.onDone()
    })

    await expect(
      detectSignificantDifference(fakeLlmConfig(), "topic", "old", "new"),
    ).resolves.toBe(false)
  })
})
