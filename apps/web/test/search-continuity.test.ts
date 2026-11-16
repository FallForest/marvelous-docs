import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * Search does not unload the document.
 *
 * The defect: the sidebar's `onSearch` called `setQuery(value)` and then, for any
 * non-empty value, `setHomeView('search')`, `setActive(null)` and
 * `setSelectedFolderId(null)`. `active` drives the editor branch, so the first
 * character typed into the search box unmounted the Tiptap instance, destroyed
 * the caret and the scroll position, and threw away the writer's place in the
 * document. "Search, then change my mind" was impossible.
 *
 * What is checked here is source text, because the property under test is "the
 * shell does not do the thing that remounts the editor", and that is a fact about
 * the handler, not about a rendered tree. Two assertions carry it:
 *
 *   1. the sidebar's search handler never calls `setActive`;
 *   2. the editor column's `key` does not include the query.
 *
 * A browser test would add what this cannot see: that the caret offset, the text
 * selection and the scrollTop of `.editor-column` are identical before and after
 * typing three characters into the field, and that the Tiptap instance is the same
 * object (its `editor.view.docView` identity) across those keystrokes. Text cannot
 * prove identity; a mounted component can. It is written as unmeasured here
 * rather than claimed.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

/** The body of `const name = useCallback(...)`, up to the dependency array. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf('const ' + name + ' = useCallback(')
  assert.ok(start >= 0, name + ' must stay a useCallback')
  // The handler ends at the dependency list; `}, [])` or `}, [deps])`.
  const end = source.indexOf('\n  }, ', start)
  assert.ok(end > start, name + ' must have a dependency array on its own line')
  return source.slice(start, end)
}

test('typing in the sidebar search does not change what is open', () => {
  const app = read('App.tsx')
  const body = callbackBody(app, 'handleSidebarSearch')
  assert.ok(!/setActive\s*\(/.test(body), 'the search field must not clear or replace the open document')
  assert.ok(!/setSelectedFolderId\s*\(/.test(body), 'nor the selected folder: the tree filter is enough')
  assert.ok(!/setHomeView\s*\(/.test(body), 'nor the mounted view: the results page is a separate step')
  // The one state write it is allowed to make.
  assert.match(body, /setQuery\(value\)/, 'the query is still what narrows the tree')
})

test('the editor is not remounted by a search query', () => {
  const app = read('App.tsx')
  // Both keys are on the document and the explicit replacement epoch, never on
  // `query`. Keying on the query would remount the editor on every keystroke even
  // if `active` survived — the same data loss by a different route.
  const column = /<section className="editor-column" key=\{([^}]+)\}>/.exec(app)
  assert.ok(column, 'the editor column keeps its key')
  assert.ok(!/query/i.test(column![1]!), 'the column key must not include the query')
  const editor = /<DocumentEditor\s*\n\s*key=\{([^}]+)\}/.exec(app)
  assert.ok(editor, 'the editor keeps its key')
  assert.ok(!/query/i.test(editor![1]!), 'the editor key must not include the query')
  assert.match(editor![1]!, /editorEpoch/, 'explicit replacement is the only reason to recreate it')
})

test('the results page is a deliberate second step', () => {
  const app = read('App.tsx')
  // Enter, or the 查看全部结果 row, is what navigates: one explicit path, and it is
  // the only place a search is allowed to take the editor off screen.
  const submit = callbackBody(app, 'openSearchPage')
  assert.match(submit, /setHomeView\('search'\)/)
  assert.match(submit, /setActive\(null\)/)
  // Escape clears and stays.
  const cancel = callbackBody(app, 'cancelSidebarSearch')
  assert.match(cancel, /setQuery\(''\)/)
  assert.ok(!/setActive\(null\)/.test(cancel), 'cancelling must return the writer to the document, not away from it')
})

test('the sidebar labels the results page honestly', () => {
  const sidebar = read('components/layout/Sidebar.tsx')
  // A row that appears while a query is present, says where it goes, and does not
  // pretend the field itself navigates.
  assert.match(sidebar, /search-page-entry/, 'the results-page row must exist')
  assert.match(sidebar, /查看全部结果/, 'the row must name its destination')
  assert.match(sidebar, /onSearchSubmit/, 'it must be wired to the explicit navigation')
  // Escape in the field cancels and refocuses it, and Enter submits.
  assert.match(sidebar, /event\.key === 'Enter'/)
  assert.match(sidebar, /props\.onSearchCancel\(\)/)
  // The IME guard has to come first, or confirming a Chinese candidate with Enter
  // would navigate to the results page.
  const guard = sidebar.indexOf('searchIme.current.blocked(event.nativeEvent)')
  assert.ok(guard >= 0, 'the field must consult the composition guard')
  assert.ok(guard < sidebar.indexOf("event.key === 'Enter'"), 'and must do it before reading the key')
})
