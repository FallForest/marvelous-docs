/** Programming languages offered by the code block selector. */
export const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java',
  go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP',
  swift: 'Swift', kotlin: 'Kotlin', scala: 'Scala', html: 'HTML', css: 'CSS',
  scss: 'SCSS', json: 'JSON', yaml: 'YAML', toml: 'TOML', xml: 'XML', sql: 'SQL',
  bash: 'Bash', powershell: 'PowerShell', dockerfile: 'Dockerfile',
  markdown: 'Markdown', plaintext: '纯文本', plain: '纯文本', text: '纯文本',
  js: 'JavaScript', ts: 'TypeScript', py: 'Python', sh: 'Shell', shell: 'Shell',
  yml: 'YAML', md: 'Markdown', docker: 'Dockerfile', 'c++': 'C++', cs: 'C#',
}

export const LANGUAGES: string[] = Object.keys(LANG_LABELS)

/** Human label for a language token, tolerant of case and aliases. */
export function languageLabel(token: string | null | undefined): string {
  if (!token) return '代码'
  const key = token.trim().toLowerCase()
  return LANG_LABELS[key] || token
}
