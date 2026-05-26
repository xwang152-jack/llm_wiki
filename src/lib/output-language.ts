import { detectLanguage } from "./detect-language"
import { getLanguagePromptName } from "./language-metadata"
import { defaultOutputLanguageRuntime, type OutputLanguageRuntime } from "@/lib/output-language-runtime"

/**
 * Get the effective output language for LLM content generation.
 *
 * If user has explicitly set an outputLanguage, use it.
 * Otherwise (auto), fall back to detecting the language from the given text.
 */
export function getOutputLanguage(
  fallbackText: string = "",
  runtime: OutputLanguageRuntime = defaultOutputLanguageRuntime,
): string {
  const configured = runtime.getConfiguredOutputLanguage()
  if (configured && configured !== "auto") {
    return configured
  }
  return detectLanguage(fallbackText || "English")
}

/**
 * Build a strong language directive to inject into system prompts.
 */
export function buildLanguageDirective(
  fallbackText: string = "",
  runtime: OutputLanguageRuntime = defaultOutputLanguageRuntime,
): string {
  const lang = getOutputLanguage(fallbackText, runtime)
  const promptLang = getLanguagePromptName(lang)
  return [
    `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${promptLang}`,
    "",
    `You MUST write your entire response (including wiki page titles, content, descriptions, summaries, and any generated text) in **${promptLang}**.`,
    `The source material or wiki content may be in a different language, but this is IRRELEVANT to your output language.`,
    `Ignore the language of any source content. Generate everything in ${promptLang} only.`,
    `Proper nouns should use standard ${promptLang} transliteration when appropriate.`,
    `DO NOT use any other language. This overrides all other instructions.`,
  ].join("\n")
}

/**
 * Short reminder version — for placing right before user's current message.
 */
export function buildLanguageReminder(
  fallbackText: string = "",
  runtime: OutputLanguageRuntime = defaultOutputLanguageRuntime,
): string {
  const lang = getOutputLanguage(fallbackText, runtime)
  return `REMINDER: All output must be in ${getLanguagePromptName(lang)}. Do not use any other language.`
}
