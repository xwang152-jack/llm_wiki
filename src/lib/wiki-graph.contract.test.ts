import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { realFs } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)
vi.mock("@/lib/graph-snapshot", () => ({
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/graph-relevance", () => ({
  buildRetrievalGraph: vi.fn().mockResolvedValue({ nodes: new Map(), dataVersion: 0 }),
  calculateRelevance: vi.fn(() => 1),
  clearGraphCache: vi.fn(),
}))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({ dataVersion: 0 }),
  },
}))

import { buildWikiGraph } from "./wiki-graph"

const fixtureProjectPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test-fixtures/graph-contract",
).replace(/\\/g, "/")

describe("buildWikiGraph contract fixture", () => {
  it("keeps TS graph parsing aligned with the shared fixture expectations", async () => {
    const graph = await buildWikiGraph(fixtureProjectPath)

    const nodes = [...graph.nodes]
      .map(({ id, label, type }) => ({ id, label, type }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(nodes).toEqual([
      { id: "attention-is-all-you-need", label: "Attention Is All You Need", type: "concept" },
      { id: "bert", label: "BERT", type: "entity" },
      { id: "transformer-architecture", label: "Transformer Architecture", type: "concept" },
    ])

    const edges = [...graph.edges]
      .map(({ source, target }) => [source, target].sort().join("::"))
      .sort()
    expect(edges).toEqual([
      "attention-is-all-you-need::bert",
      "attention-is-all-you-need::transformer-architecture",
    ])
  })
})
