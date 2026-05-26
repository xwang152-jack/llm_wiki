import { writeFile, readFile } from "@/commands/fs"
import { webSearch, type WebSearchResult } from "./web-search"
import { streamChat } from "./llm-client"
import type { LlmConfig, SearchApiConfig } from "@/types/config"
import { normalizePath } from "@/lib/path-utils"
import { buildLanguageDirective } from "@/lib/output-language"
import type { DeepResearchRuntime } from "@/lib/deep-research-runtime"

function buildResearchSystemPrompt(topic: string, wikiIndex: string): string {
  return [
    "You are a research assistant. Synthesize the web search results into a comprehensive wiki page.",
    "",
    buildLanguageDirective(topic),
    "",
    "## Cross-referencing (IMPORTANT)",
    "- The wiki already has existing pages listed in the Wiki Index below.",
    "- When your synthesis mentions an entity or concept that exists in the wiki, ALWAYS use [[wikilink]] syntax to link to it.",
    "- For example, if the wiki has an entity 'anthropic', write [[anthropic]] when mentioning it.",
    "- This is critical for connecting new research to existing knowledge in the graph.",
    "",
    "## Writing Rules",
    "- Organize into clear sections with headings",
    "- Cite web sources using [N] notation",
    "- Note contradictions or gaps",
    "- Suggest additional sources worth finding",
    "- Neutral, encyclopedic tone",
    "",
    wikiIndex ? `## Existing Wiki Index (link to these pages with [[wikilink]])\n${wikiIndex}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function buildResearchUserPrompt(topic: string, webResults: WebSearchResult[]): string {
  const searchContext = webResults
    .map((result, index) => `[${index + 1}] **${result.title}** (${result.source})\n${result.snippet}`)
    .join("\n\n")

  return `Research topic: **${topic}**\n\n## Web Search Results\n\n${searchContext}\n\nSynthesize into a wiki page.`
}

export function buildResearchPageContent(
  topic: string,
  date: string,
  synthesis: string,
  webResults: WebSearchResult[],
): { fileName: string; pageContent: string; savedPath: string } {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
  const fileName = `research-${slug}-${date}.md`
  const savedPath = `wiki/queries/${fileName}`
  const references = webResults
    .map((result, index) => `${index + 1}. [${result.title}](${result.url}) — ${result.source}`)
    .join("\n")

  const cleanedSynthesis = synthesis
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trimStart()

  const pageContent = [
    "---",
    `type: query`,
    `title: "Research: ${topic.replace(/"/g, '\\"')}"`,
    `created: ${date}`,
    `origin: deep-research`,
    `tags: [research]`,
    "---",
    "",
    `# Research: ${topic}`,
    "",
    cleanedSynthesis,
    "",
    "## References",
    "",
    references,
    "",
  ].join("\n")

  return { fileName, pageContent, savedPath }
}

async function collectWebResults(
  queries: string[],
  searchConfig: SearchApiConfig,
): Promise<WebSearchResult[]> {
  const allResults: WebSearchResult[] = []
  const seenUrls = new Set<string>()

  for (const query of queries) {
    try {
      const results = await webSearch(query, searchConfig, 5)
      for (const result of results) {
        if (seenUrls.has(result.url)) continue
        seenUrls.add(result.url)
        allResults.push(result)
      }
    } catch {
      // continue with other queries
    }
  }

  return allResults
}

export async function executeDeepResearchTask(
  projectPath: string,
  taskId: string,
  topic: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
  runtime: DeepResearchRuntime,
): Promise<void> {
  const pp = normalizePath(projectPath)

  try {
    runtime.updateTask(taskId, { status: "searching" })

    const task = runtime.getTask(taskId)
    const queries = task?.searchQueries && task.searchQueries.length > 0 ? task.searchQueries : [topic]
    const webResults = await collectWebResults(queries, searchConfig)
    runtime.updateTask(taskId, { webResults })

    if (webResults.length === 0) {
      runtime.updateTask(taskId, { status: "done", synthesis: "No web results found." })
      return
    }

    runtime.updateTask(taskId, { status: "synthesizing" })

    let wikiIndex = ""
    try {
      wikiIndex = await readFile(`${pp}/wiki/index.md`)
    } catch {
      // no index yet
    }

    let accumulated = ""

    await streamChat(
      llmConfig,
      [
        { role: "system", content: buildResearchSystemPrompt(topic, wikiIndex) },
        { role: "user", content: buildResearchUserPrompt(topic, webResults) },
      ],
      {
        onToken: (token) => {
          accumulated += token
          runtime.updateTask(taskId, { synthesis: accumulated })
        },
        onDone: () => {},
        onError: (err) => {
          runtime.updateTask(taskId, {
            status: "error",
            error: err.message,
          })
        },
      },
    )

    if (runtime.getTask(taskId)?.status === "error") return

    runtime.updateTask(taskId, { status: "saving", synthesis: accumulated })

    const date = new Date().toISOString().slice(0, 10)
    const { fileName, pageContent, savedPath } = buildResearchPageContent(
      topic,
      date,
      accumulated,
      webResults,
    )
    await writeFile(`${pp}/wiki/queries/${fileName}`, pageContent)

    runtime.updateTask(taskId, {
      status: "done",
      savedPath,
    })

    await runtime.refreshProjectTree(pp)
    runtime.autoIngestResearchPage(pp, savedPath, llmConfig).catch((err) => {
      console.error("Failed to auto-ingest research result:", err)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    runtime.updateTask(taskId, {
      status: "error",
      error: message,
    })
  }
}
