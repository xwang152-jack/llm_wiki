import { describe, expect, it } from "vitest"
import type { FileNode } from "@/types/wiki"
import {
  extractWikiLinks,
  flattenMarkdownFiles,
  parseWikiGraphDocument,
  resolveWikiLinkTarget,
  wikiFileNameToId,
} from "./wiki-graph-document"

describe("wiki graph document helpers", () => {
  it("parses graph metadata from frontmatter, heading, and wikilinks", () => {
    const content = `---
title: "Attention Is All You Need"
type: concept
sources:
  - "paper.pdf"
  - notes.md
---

[[transformer-architecture]]
[[BERT|model]]
`

    expect(parseWikiGraphDocument(content, "attention-is-all-you-need.md")).toEqual({
      id: "attention-is-all-you-need",
      title: "Attention Is All You Need",
      type: "concept",
      sources: ["paper.pdf", "notes.md"],
      links: ["transformer-architecture", "BERT"],
    })
  })

  it("falls back to heading or filename when frontmatter fields are missing", () => {
    expect(
      parseWikiGraphDocument("# Transformer Architecture\n", "transformer-architecture.md"),
    ).toEqual({
      id: "transformer-architecture",
      title: "Transformer Architecture",
      type: "other",
      sources: [],
      links: [],
    })

    expect(parseWikiGraphDocument("plain body", "kv-cache.md")).toEqual({
      id: "kv-cache",
      title: "kv cache",
      type: "other",
      sources: [],
      links: [],
    })
  })

  it("supports flattening markdown nodes and normalized target resolution", () => {
    const tree: FileNode[] = [
      {
        name: "wiki",
        path: "/tmp/wiki",
        is_dir: true,
        children: [
          {
            name: "attention-is-all-you-need.md",
            path: "/tmp/wiki/attention-is-all-you-need.md",
            is_dir: false,
            children: [],
          },
          {
            name: "assets",
            path: "/tmp/wiki/assets",
            is_dir: true,
            children: [
              {
                name: "diagram.png",
                path: "/tmp/wiki/assets/diagram.png",
                is_dir: false,
                children: [],
              },
            ],
          },
        ],
      },
    ]

    expect(flattenMarkdownFiles(tree).map((file) => file.name)).toEqual([
      "attention-is-all-you-need.md",
    ])
    expect(wikiFileNameToId("bert.md")).toBe("bert")
    expect(extractWikiLinks("See [[Attention Is All You Need|paper]] and [[bert]].")).toEqual([
      "Attention Is All You Need",
      "bert",
    ])
    expect(
      resolveWikiLinkTarget(
        "Attention Is All You Need",
        new Set(["attention-is-all-you-need", "bert"]),
      ),
    ).toBe("attention-is-all-you-need")
    expect(resolveWikiLinkTarget("missing", new Set(["bert"]))).toBeNull()
  })
})
