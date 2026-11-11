/** Canonical code block languages, in the order the picker shows them. */
export const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'plaintext', label: '纯文本' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'scala', label: 'Scala' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'xml', label: 'XML' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'markdown', label: 'Markdown' },
]

/** Display names keyed by canonical id. */
export const LANG_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((entry) => [entry.id, entry.label]),
)

/**
 * Alternate spellings that map onto a canonical id.
 *
 * Documents imported from Markdown carry whatever the fence said (`js`, `yml`,
 * `sh`), so alias resolution has to survive that. Only used for lookup — these
 * never appear as separate entries in the picker.
 */
const ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  golang: 'go',
  rs: 'rust',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  ps: 'powershell', ps1: 'powershell',
  docker: 'dockerfile',
  text: 'plaintext', plain: 'plaintext', txt: 'plaintext', none: 'plaintext',
  // Stored grammar names that differ from the picker id.
  ini: 'toml',
}

/** Resolves any spelling (canonical or alias) to a canonical id, or null. */
export function canonicalLanguage(token: string | null | undefined): string | null {
  if (!token) return null
  const key = token.trim().toLowerCase()
  if (!key) return null
  if (LANG_LABELS[key]) return key
  return ALIASES[key] ?? null
}

/** Human label for any language token, tolerant of case and aliases. */
export function languageLabel(token: string | null | undefined): string {
  if (!token) return '代码'
  const canonical = canonicalLanguage(token)
  if (canonical) return LANG_LABELS[canonical]
  // Unknown fence language (e.g. objective-c): show it verbatim rather than a
  // blank control, so the user can see what the document actually contains.
  return token.trim()
}
