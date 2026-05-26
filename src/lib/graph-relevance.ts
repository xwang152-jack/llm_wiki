import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import {
  flattenMarkdownFiles,
  parseWikiGraphDocument,
  resolveWikiLinkTarget,
} from "./wiki-graph-document"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievalNode {
  readonly id: string
  readonly title: string
  readonly type: string
  readonly path: string
  readonly sources: readonly string[]
  readonly outLinks: ReadonlySet<string>
  readonly inLinks: ReadonlySet<string>
  readonly community?: number
}

export interface RetrievalGraph {
  readonly nodes: ReadonlyMap<string, RetrievalNode>
  readonly dataVersion: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_RELEVANCE = 0.3

const WEIGHTS = {
  directLink: 3.0,
  sourceOverlap: 4.0,
  commonNeighbor: 1.5,
  typeAffinity: 1.0,
  sameCommunity: 1.2,
} as const

const TYPE_AFFINITY: Record<string, Record<string, number>> = {
  entity: { concept: 1.2, entity: 0.8, source: 1.0, synthesis: 1.0, query: 0.8 },
  concept: { entity: 1.2, concept: 0.8, source: 1.0, synthesis: 1.2, query: 1.0 },
  source: { entity: 1.0, concept: 1.0, source: 0.5, query: 0.8, synthesis: 1.0 },
  query: { concept: 1.0, entity: 0.8, synthesis: 1.0, source: 0.8, query: 0.5 },
  synthesis: { concept: 1.2, entity: 1.0, source: 1.0, query: 1.0, synthesis: 0.8 },
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let cachedGraph: RetrievalGraph | null = null

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function getNeighbors(node: RetrievalNode): ReadonlySet<string> {
  const neighbors = new Set<string>()
  for (const id of node.outLinks) neighbors.add(id)
  for (const id of node.inLinks) neighbors.add(id)
  return neighbors
}

function getNodeDegree(node: RetrievalNode): number {
  return node.outLinks.size + node.inLinks.size
}

function getAverageDegree(graph: RetrievalGraph): number {
  if (graph.nodes.size === 0) return 0
  let totalDegree = 0
  for (const node of graph.nodes.values()) {
    totalDegree += node.outLinks.size + node.inLinks.size
  }
  return totalDegree / graph.nodes.size
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export async function buildRetrievalGraph(
  projectPath: string,
  dataVersion: number = 0,
  communities?: Map<string, number>,
): Promise<RetrievalGraph> {
  // Return cached if version matches
  if (cachedGraph !== null && cachedGraph.dataVersion === dataVersion) {
    return cachedGraph
  }

  const wikiRoot = `${normalizePath(projectPath)}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    const emptyGraph: RetrievalGraph = { nodes: new Map(), dataVersion }
    cachedGraph = emptyGraph
    return emptyGraph
  }

  const mdFiles = flattenMarkdownFiles(tree)

  // First pass: read all files and build raw node data
  const rawNodes: Array<{
    id: string
    title: string
    type: string
    path: string
    sources: string[]
    rawLinks: string[]
    fileName: string
  }> = []

  const results = await Promise.all(
    mdFiles.map(async (file) => {
      try {
        const content = await readFile(file.path)
        const parsed = parseWikiGraphDocument(content, file.name)
        return {
          id: parsed.id,
          title: parsed.title,
          type: parsed.type,
          path: file.path,
          sources: parsed.sources,
          rawLinks: parsed.links,
          fileName: file.name,
        }
      } catch {
        return null
      }
    }),
  )
  rawNodes.push(...results.filter((r): r is NonNullable<typeof r> => r !== null))

  const nodeIds = new Set(rawNodes.map((n) => n.id))

  // Second pass: resolve links and build graph nodes
  const outLinksMap = new Map<string, Set<string>>()
  const inLinksMap = new Map<string, Set<string>>()

  for (const id of nodeIds) {
    outLinksMap.set(id, new Set())
    inLinksMap.set(id, new Set())
  }

  for (const raw of rawNodes) {
    for (const linkTarget of raw.rawLinks) {
      const resolvedId = resolveWikiLinkTarget(linkTarget, nodeIds)
      if (resolvedId === null || resolvedId === raw.id) continue
      outLinksMap.get(raw.id)!.add(resolvedId)
      inLinksMap.get(resolvedId)!.add(raw.id)
    }
  }

  // Build immutable nodes map
  const nodes = new Map<string, RetrievalNode>()
  for (const raw of rawNodes) {
    const community = communities?.get(raw.id)
    nodes.set(raw.id, {
      id: raw.id,
      title: raw.title,
      type: raw.type,
      path: raw.path,
      sources: Object.freeze([...raw.sources]),
      outLinks: Object.freeze(outLinksMap.get(raw.id) ?? new Set<string>()),
      inLinks: Object.freeze(inLinksMap.get(raw.id) ?? new Set<string>()),
      ...(community !== undefined ? { community } : {}),
    })
  }

  const graph: RetrievalGraph = { nodes, dataVersion }
  cachedGraph = graph
  return graph
}

export function calculateRelevance(
  nodeA: RetrievalNode,
  nodeB: RetrievalNode,
  graph: RetrievalGraph,
): number {
  if (nodeA.id === nodeB.id) return 0

  // Signal 1: Direct links (weight 3.0)
  const forwardLinks = nodeA.outLinks.has(nodeB.id) ? 1 : 0
  const backwardLinks = nodeB.outLinks.has(nodeA.id) ? 1 : 0
  const directLinkScore = (forwardLinks + backwardLinks) * WEIGHTS.directLink

  // Signal 2: Source overlap (weight 4.0)
  const sourcesA = new Set(nodeA.sources)
  let sharedSourceCount = 0
  for (const src of nodeB.sources) {
    if (sourcesA.has(src)) sharedSourceCount += 1
  }
  const sourceOverlapScore = sharedSourceCount * WEIGHTS.sourceOverlap

  // Signal 3: Common neighbors - Adamic-Adar (weight 1.5)
  const neighborsA = getNeighbors(nodeA)
  const neighborsB = getNeighbors(nodeB)
  let adamicAdar = 0
  for (const neighborId of neighborsA) {
    if (neighborsB.has(neighborId)) {
      const neighbor = graph.nodes.get(neighborId)
      if (neighbor) {
        const degree = getNodeDegree(neighbor)
        adamicAdar += 1 / Math.log(Math.max(degree, 2))
      }
    }
  }
  const commonNeighborScore = adamicAdar * WEIGHTS.commonNeighbor

  // Signal 4: Type affinity (weight 1.0)
  const affinityMap = TYPE_AFFINITY[nodeA.type]
  const typeAffinityScore = (affinityMap?.[nodeB.type] ?? 0.5) * WEIGHTS.typeAffinity

  // Signal 5: Same community bonus (weight 1.2)
  let communityScore = 0
  if (nodeA.community !== undefined && nodeB.community !== undefined) {
    communityScore = nodeA.community === nodeB.community ? WEIGHTS.sameCommunity : 0
  }

  return directLinkScore + sourceOverlapScore + commonNeighborScore + typeAffinityScore + communityScore
}

export function getRelatedNodes(
  nodeId: string,
  graph: RetrievalGraph,
  limit: number = 5,
): ReadonlyArray<{ node: RetrievalNode; relevance: number }> {
  const sourceNode = graph.nodes.get(nodeId)
  if (!sourceNode) return []

  const avgDegree = getAverageDegree(graph)
  // Dense graph (>10 avg degree): restrict to 1-hop neighbors only
  // Sparse graph (≤5 avg degree): full 2-hop scoring
  // Medium (5-10): 1-hop with lower threshold
  const denseMode = avgDegree > 10
  const sparseMode = avgDegree <= 5

  const scored: Array<{ node: RetrievalNode; relevance: number }> = []

  for (const [id, node] of graph.nodes) {
    if (id === nodeId) continue

    // In dense mode, only consider direct neighbors or source-overlapping nodes
    if (denseMode) {
      const hasDirectLink = sourceNode.outLinks.has(id) || sourceNode.inLinks.has(id)
      const hasSourceOverlap = node.sources.some(s => sourceNode.sources.includes(s))
      if (!hasDirectLink && !hasSourceOverlap) continue
    }

    const relevance = calculateRelevance(sourceNode, node, graph)
    const threshold = sparseMode ? 0 : MIN_RELEVANCE
    if (relevance >= threshold) {
      scored.push({ node, relevance })
    }
  }

  scored.sort((a, b) => b.relevance - a.relevance)
  return scored.slice(0, limit)
}

export function clearGraphCache(): void {
  cachedGraph = null
}
