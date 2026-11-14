import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const styles = fileURLToPath(new URL('../src/styles/', import.meta.url))
const flow = /^(?:display|position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|gap|order|isolation|z-index|box-sizing|vertical-align|text-align|text-overflow|text-indent|white-space|overflow(?:-wrap)?|scrollbar-gutter|scroll-padding-block|border-collapse|border-spacing|content|transform|pointer-events|cursor|user-select|object-fit|-webkit-box-orient|-webkit-line-clamp|--side-w|--row-h|--row-pad|--font-handwritten|(?:margin|padding|flex|grid|align|justify|font)(?:-[\w-]+)?|letter-spacing|line-height|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|border-(?:top-|right-|bottom-|left-)?width)$/

test('appearance skins cannot change shared component geometry or typography', () => {
  const offenders: string[] = []
  for (const name of readdirSync(styles).filter(name => /^handdrawn.*\.css$/.test(name))) {
    const source = readFileSync(join(styles, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector!.includes('[data-theme=')) continue
      // Both image variants occupy the same fixed ArtIcon slot. Switching the
      // pixels inside that slot is the one intentional display difference.
      if (/\.art-icon-(?:image|fallback)|\[data-art-failed\]/.test(selector!)) continue
      for (const [, property] of body!.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)) {
        if (flow.test(property!)) offenders.push(`${name}: ${selector!.trim()} -> ${property}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'put layout and typography in layout.css; keep only paint in appearance skins')
})

test('illustration slots participate in both themes instead of appearing in only one', () => {
  const layout = readFileSync(join(styles, 'layout.css'), 'utf8')
  assert.match(layout, /:root\s+\.theme-decoration\s*\{\s*display:block/)
  assert.match(layout, /:root\s+\.art-icon\s*\{[^}]*width:28px[^}]*height:28px/)
  assert.match(layout, /:root\s+\.art-icon-fallback\s*\{[^}]*width:100%[^}]*height:100%/)
})
