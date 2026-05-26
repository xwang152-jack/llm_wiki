import { describe, expect, it } from "vitest"
import { buildResearchPageContent } from "./deep-research-coordinator"

describe("buildResearchPageContent", () => {
  it("strips think blocks and builds a wiki queries path", () => {
    const result = buildResearchPageContent(
      'Attention "Mechanism"',
      "2026-05-25",
      "<think>internal chain</think>\n\nFinal synthesis body",
      [
        {
          title: "Paper A",
          url: "https://example.com/paper-a",
          snippet: "snippet",
          source: "example",
        },
      ],
    )

    expect(result.fileName).toBe("research-attention-mechanism-2026-05-25.md")
    expect(result.savedPath).toBe("wiki/queries/research-attention-mechanism-2026-05-25.md")
    expect(result.pageContent).toContain('# Research: Attention "Mechanism"')
    expect(result.pageContent).toContain("Final synthesis body")
    expect(result.pageContent).toContain("1. [Paper A](https://example.com/paper-a) — example")
    expect(result.pageContent).not.toContain("<think>")
    expect(result.pageContent).toContain('title: "Research: Attention \\"Mechanism\\""')
  })
})
