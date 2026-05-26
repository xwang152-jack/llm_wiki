import type { FileNode } from "@/types/wiki"

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

export interface WikiGraphDocument {
  id: string
  title: string
  type: string
  sources: string[]
  links: string[]
}

export function flattenMarkdownFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMarkdownFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

export function wikiFileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  return match ? match[1] : ""
}

function extractFrontmatterField(frontmatter: string, field: string): string {
  const match = frontmatter.match(
    new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, "m"),
  )
  return match?.[1]?.trim() ?? ""
}

function extractSources(frontmatter: string): string[] {
  const sources: string[] = []
  const sourcesBlockMatch = frontmatter.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m)
  if (sourcesBlockMatch) {
    const lines = sourcesBlockMatch[1].split("\n")
    for (const line of lines) {
      const itemMatch = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/)
      if (itemMatch?.[1]) {
        sources.push(itemMatch[1])
      }
    }
    return sources
  }

  const inlineMatch = frontmatter.match(/^sources:\s*\[([^\]]*)\]/m)
  if (!inlineMatch) {
    return sources
  }
  for (const item of inlineMatch[1].split(",")) {
    const trimmed = item.trim().replace(/^["']|["']$/g, "")
    if (trimmed) {
      sources.push(trimmed)
    }
  }
  return sources
}

export function extractWikiLinks(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(WIKILINK_REGEX.source, "g")
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

export function parseWikiGraphDocument(
  content: string,
  fileName: string,
): WikiGraphDocument {
  const frontmatter = extractFrontmatter(content)
  let title = extractFrontmatterField(frontmatter, "title")
  if (!title) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    title = headingMatch?.[1]?.trim() ?? ""
  }

  return {
    id: wikiFileNameToId(fileName),
    title: title || fileName.replace(/\.md$/, "").replace(/-/g, " "),
    type: extractFrontmatterField(frontmatter, "type").toLowerCase() || "other",
    sources: extractSources(frontmatter),
    links: extractWikiLinks(content),
  }
}

export function resolveWikiLinkTarget(
  raw: string,
  nodeIds: ReadonlySet<string>,
): string | null {
  if (nodeIds.has(raw)) return raw

  const normalized = raw.toLowerCase().replace(/\s+/g, "-")
  for (const id of nodeIds) {
    const idLower = id.toLowerCase()
    if (idLower === normalized) return id
    if (idLower === raw.toLowerCase()) return id
    if (idLower.replace(/\s+/g, "-") === normalized) return id
  }
  return null
}
