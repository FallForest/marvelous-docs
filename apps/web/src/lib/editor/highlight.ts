import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import ini from 'highlight.js/lib/languages/ini'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'

/**
 * Syntax highlighting for code blocks, one grammar per language the picker
 * offers.
 *
 * The imports are explicit rather than `common` (37 grammars) or `all` (192)
 * because the bundle is the cost: `common` added 180 KB to the entry chunk and
 * `all` took it to 1.1 MB, for languages this app cannot even select.
 *
 * `highlight.js` is a direct dependency, not a transitive one: under pnpm's
 * strict node_modules, importing a transitive package's subpath fails to resolve
 * at build time.
 *
 * The registry is created once at module scope, since `lowlight()` registers
 * every grammar eagerly.
 */
export const lowlight = createLowlight({
  javascript, typescript, python, java, go, rust, c, cpp, csharp, ruby, php,
  swift, kotlin, scala, xml, css, scss, json, yaml, ini, sql, bash, powershell,
  dockerfile, markdown, plaintext,
})

/**
 * Maps an editor language id to the grammar name Lowlight knows it by.
 *
 * Our ids are chosen for the picker; the few that differ from highlight.js are
 * listed here. Anything unmapped falls through to the id itself, and an unknown
 * id highlights as plain text rather than throwing.
 */
const GRAMMAR_ALIASES: Record<string, string> = {
  html: 'xml',
  toml: 'ini',
}

/** The grammar name to hand to Lowlight for an editor language id. */
export function grammarFor(language: string): string {
  const key = (language || '').trim().toLowerCase()
  if (!key || key === 'plaintext') return 'plaintext'
  return GRAMMAR_ALIASES[key] ?? key
}

/** True when a grammar exists for this id. */
export function supportsLanguage(language: string): boolean {
  return lowlight.registered(grammarFor(language))
}

/**
 * Resolves an id to the grammar to highlight with, falling back to plaintext.
 *
 * Lowlight itself throws on an unregistered language. The Tiptap plugin guards
 * against that by calling `highlightAuto` when it does not recognise the name,
 * which guesses a language — unpredictable output on a block the user labelled.
 * Exporting this keeps the decision explicit and testable; `renderStaticHighlight`
 * below uses it for the HTML export path.
 */
export function safeGrammar(language: string): string {
  const name = grammarFor(language)
  return lowlight.registered(name) ? name : 'plaintext'
}
