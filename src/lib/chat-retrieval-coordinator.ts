import { readFile } from "@/commands/fs"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { buildRetrievalGraph, getRelatedNodes } from "@/lib/graph-relevance"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget } from "@/lib/context-budget"
import { resolveSystemPrompt } from "@/lib/prompt-templates"
import type { ChatMessage as LLMMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/types/config"
import type { WikiProject } from "@/types/wiki"

export interface QueryReference {
  title: string
  path: string
}

export interface RetrievalPage extends QueryReference {}

interface BuildRetrievalContextInput {
  project: WikiProject | null
  text: string
  llmConfig: LlmConfig
  dataVersion: number
  activePromptTemplate: string | null
  customPromptTemplates: Record<string, string>
}

interface BuildRetrievalContextResult {
  systemMessages: LLMMessage[]
  queryRefs: QueryReference[]
  langReminder?: string
  lastQueryPages: RetrievalPage[]
}

interface PageEntry extends RetrievalPage {
  content: string
}

function trimIndexToBudget(rawIndex: string, query: string, indexBudget: number): string {
  if (rawIndex.length <= indexBudget) return rawIndex

  const tokens = tokenizeQuery(query)
  const lines = rawIndex.split("\n")
  const keptLines: string[] = []
  let keptSize = 0

  for (const line of lines) {
    const isHeader = line.startsWith("##")
    const lower = line.toLowerCase()
    const isRelevant = tokens.some((token) => lower.includes(token))

    if ((isHeader || isRelevant) && keptSize + line.length + 1 <= indexBudget) {
      keptLines.push(line)
      keptSize += line.length + 1
    }
  }

  const trimmed = keptLines.join("\n")
  return trimmed.length < rawIndex.length
    ? `${trimmed}\n\n[...index trimmed to relevant entries...]`
    : trimmed
}

async function collectRelevantPages(
  projectPath: string,
  query: string,
  dataVersion: number,
  pageBudget: number,
  maxPageSize: number,
): Promise<PageEntry[]> {
  const pp = normalizePath(projectPath)
  const searchResults = await searchWiki(pp, query)
  const topSearchResults = searchResults.slice(0, 10)
  const graph = await buildRetrievalGraph(pp, dataVersion)
  const expandedIds = new Set<string>()
  const searchHitPaths = new Set(topSearchResults.map((result) => result.path))
  const graphExpansions: { title: string; path: string; relevance: number }[] = []

  for (const result of topSearchResults) {
    const fileName = getFileName(result.path)
    const nodeId = fileName.replace(/\.md$/, "")
    const related = getRelatedNodes(nodeId, graph, 3)
    for (const { node, relevance } of related) {
      if (relevance < 2.0) continue
      if (searchHitPaths.has(node.path)) continue
      if (expandedIds.has(node.id)) continue
      expandedIds.add(node.id)
      graphExpansions.push({ title: node.title, path: node.path, relevance })
    }
  }

  graphExpansions.sort((a, b) => b.relevance - a.relevance)

  let usedChars = 0
  const relevantPages: PageEntry[] = []

  const tryAddPage = async (title: string, filePath: string): Promise<boolean> => {
    if (usedChars >= pageBudget) return false
    try {
      const raw = await readFile(filePath)
      const relativePath = getRelativePath(filePath, pp)
      const truncated =
        raw.length > maxPageSize ? `${raw.slice(0, maxPageSize)}\n\n[...truncated...]` : raw
      if (usedChars + truncated.length > pageBudget) return false
      usedChars += truncated.length
      relevantPages.push({ title, path: relativePath, content: truncated })
      return true
    } catch {
      return false
    }
  }

  for (const result of topSearchResults.filter((result) => result.titleMatch)) {
    await tryAddPage(result.title, result.path)
  }
  for (const result of topSearchResults.filter((result) => !result.titleMatch)) {
    await tryAddPage(result.title, result.path)
  }
  for (const expansion of graphExpansions) {
    await tryAddPage(expansion.title, expansion.path)
  }
  if (relevantPages.length === 0) {
    await tryAddPage("Overview", `${pp}/wiki/overview.md`)
  }

  return relevantPages
}

export async function buildChatRetrievalContext(
  input: BuildRetrievalContextInput,
): Promise<BuildRetrievalContextResult> {
  const { project, text, llmConfig, dataVersion, activePromptTemplate, customPromptTemplates } = input
  const systemMessages: LLMMessage[] = []

  if (!project) {
    return { systemMessages, queryRefs: [], lastQueryPages: [] }
  }

  if (isGreeting(text)) {
    const outLang = getOutputLanguage(text)
    systemMessages.push({
      role: "system",
      content: [
        `You are a wiki assistant for the project "${project.name}".`,
        "The user sent a casual greeting - reply briefly and naturally, in one or two sentences.",
        "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
        "",
        `Respond in ${outLang}.`,
      ].join("\n"),
    })
    return { systemMessages, queryRefs: [], lastQueryPages: [] }
  }

  const pp = normalizePath(project.path)
  const { indexBudget, pageBudget, maxPageSize } = computeContextBudget(llmConfig.maxContextSize)
  const [rawIndex, purpose] = await Promise.all([
    readFile(`${pp}/wiki/index.md`).catch(() => ""),
    readFile(`${pp}/purpose.md`).catch(() => ""),
  ])

  const relevantPages = await collectRelevantPages(project.path, text, dataVersion, pageBudget, maxPageSize)
  const index = trimIndexToBudget(rawIndex, text, indexBudget)
  const outLang = getOutputLanguage(text)
  const personaLine = resolveSystemPrompt(
    activePromptTemplate,
    customPromptTemplates,
    "You are a knowledgeable wiki assistant. Answer questions based on the wiki content provided below.",
  )

  const pagesContext =
    relevantPages.length > 0
      ? relevantPages
          .map((page, index) => `### [${index + 1}] ${page.title}\nPath: ${page.path}\n\n${page.content}`)
          .join("\n\n---\n\n")
      : "(No wiki pages found)"

  const pageList = relevantPages
    .map((page, index) => `[${index + 1}] ${page.title} (${page.path})`)
    .join("\n")

  systemMessages.push({
    role: "system",
    content: [
      personaLine,
      "",
      "## Rules",
      "- Answer based ONLY on the numbered wiki pages provided below.",
      "- If the provided pages don't contain enough information, say so honestly.",
      "- Use [[wikilink]] syntax to reference wiki pages.",
      "- When citing information, use the page number in brackets, e.g. [1], [2].",
      "- At the VERY END of your response, add a hidden comment listing which page numbers you used:",
      "  <!-- cited: 1, 3, 5 -->",
      "",
      "Use markdown formatting for clarity.",
      "",
      purpose ? `## Wiki Purpose\n${purpose}` : "",
      index ? `## Wiki Index\n${index}` : "",
      relevantPages.length > 0 ? `## Page List\n${pageList}` : "",
      `## Wiki Pages\n\n${pagesContext}`,
      "",
      "---",
      "",
      `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${outLang}`,
      "",
      `You MUST write your entire response in **${outLang}**.`,
      `The wiki content above may be in a different language, but this is IRRELEVANT to your output language.`,
      `Ignore the language of the wiki content. Write in ${outLang} only.`,
      `Even proper nouns should use standard ${outLang} transliteration when appropriate.`,
      `DO NOT use any other language. This overrides all other instructions.`,
    ]
      .filter(Boolean)
      .join("\n"),
  })

  const lastQueryPages = relevantPages.map((page) => ({ title: page.title, path: page.path }))
  return {
    systemMessages,
    queryRefs: [...lastQueryPages],
    lastQueryPages,
    langReminder: buildLanguageReminder(text),
  }
}

export function composeChatRequestMessages(
  systemMessages: LLMMessage[],
  historyMessages: LLMMessage[],
  langReminder?: string,
): LLMMessage[] {
  let llmMessages: LLMMessage[] = [...systemMessages, ...historyMessages]
  if (langReminder && historyMessages.length > 0) {
    const lastIdx = llmMessages.length - 1
    const last = llmMessages[lastIdx]
    if (last?.role === "user") {
      llmMessages = [
        ...llmMessages.slice(0, lastIdx),
        { role: "user", content: `[${langReminder}]\n\n${last.content}` },
      ]
    }
  }
  return llmMessages
}
