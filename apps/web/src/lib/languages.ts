/** Programming languages offered by the code block selector. */
export const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java',
  go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP',
  swift: 'Swift', kotlin: 'Kotlin', scala: 'Scala', html: 'HTML', css: 'CSS',
  scss: 'SCSS', json: 'JSON', yaml: 'YAML', toml: 'TOML', xml: 'XML', sql: 'SQL',
  bash: 'Bash', powershell: 'PowerShell', dockerfile: 'Dockerfile',
  markdown: 'Markdown', plaintext: '纯文本',
}

export const LANGUAGES: string[] = Object.keys(LANG_LABELS)
