import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')
const readStyle = (name: string) => readFileSync(join(SRC, 'styles', name), 'utf8')

/**
 * Phone capability matrix (CONTRACTS.md §5).
 *
 * At max-width:560px, editor.css hides whole toolbar groups and re-renders them
 * inside the "更多" popover. The failure mode this file pins is silent: the CSS
 * hide rule keeps working, the menu keeps opening, and one command simply is not
 * in it — every test still passes and a phone user loses 重做, or 对齐, with no
 * error anywhere. There is no visible symptom to catch in review, so it is
 * asserted here instead.
 *
 * How the file is sliced
 * ---------------------
 * `EditorToolbar.tsx` declares every command once in `COMMANDS` and the phone
 * menu refers to commands by *id* (`['alignLeft', …]`), not by repeating the
 * label. Layout by id is what stops the two surfaces drifting, but it also means
 * a naive "does the string 左对齐 appear after tb-more" check would test nothing:
 * the label lives in COMMANDS, above the menu, for both surfaces.
 *
 * So the checks below do two things:
 *   1. slice the source at `className="tb-menu tb-more-menu"` — the one place
 *      that class name is written — to the end of the file, which is the menu
 *      plus its two closing tags, and assert that slice really is the menu;
 *   2. assert each command id required on a phone appears in that slice, and that
 *      COMMANDS resolves the label to the expected Chinese text.
 *
 * Together those two facts are the property that matters: the id is reachable in
 * the menu, and the id means the command the audit named. A rename or a dropped
 * id fails; so does pointing an id at a different command.
 */

const TOOLBAR = read('components/editor/EditorToolbar.tsx')
const EDITOR_CSS = readStyle('editor.css')

/** The popover's class list is the only occurrence of this string in the file. */
const MENU_ANCHOR = 'className="tb-menu tb-more-menu"'

function moreMenuSlice(source: string): string {
  const start = source.indexOf(MENU_ANCHOR)
  assert.ok(start >= 0, 'the phone menu must keep the .tb-more-menu panel class')
  assert.equal(source.indexOf(MENU_ANCHOR, start + 1), -1, 'only one panel may be the phone menu')
  const slice = source.slice(start)
  // The panel is the last element in the component, so what follows it is only
  // the two closing </div>s and the function's closing brace. A larger tail means
  // the anchor moved and the slice is no longer "the menu" — fail loudly rather
  // than assert against the wrong region.
  assert.ok(slice.includes('</Popover>'), 'the phone menu slice must be a whole popover')
  const tail = slice.slice(slice.indexOf('</Popover>') + '</Popover>'.length)
  assert.match(tail, /^\s*<\/div>\s*<\/div>\s*\}\s*$/, 'the phone menu must be the last element of EditorToolbar.tsx')
  return slice
}

/** `id -> label`, read from the single COMMANDS declaration. */
function commandLabels(source: string): Map<string, string> {
  const start = source.indexOf('const COMMANDS = {')
  assert.ok(start >= 0, 'COMMANDS must stay a single declaration')
  const end = source.indexOf('} satisfies Record<string, Command>', start)
  assert.ok(end > start, 'COMMANDS must keep its satisfies clause')
  const block = source.slice(start, end)
  // Entry starts, sliced to the next one: a command body contains nested braces
  // and multi-line `run` expressions, so matching the body with a regex would
  // either stop early or swallow the next command.
  const starts = [...block.matchAll(/^ {2}(\w+): \{/gm)]
  const labels = new Map<string, string>()
  for (const [index, entry] of starts.entries()) {
    const from = entry.index!
    const to = index + 1 < starts.length ? starts[index + 1]!.index! : block.length
    const label = /label: '([^']+)'/.exec(block.slice(from, to))
    assert.ok(label, 'command ' + entry[1] + ' must declare its label')
    labels.set(entry[1]!, label[1]!)
  }
  assert.ok(labels.size > 20, 'COMMANDS should hold every toolbar command, parsed ' + labels.size)
  return labels
}

const LABELS = commandLabels(TOOLBAR)
const MENU = moreMenuSlice(TOOLBAR)

/**
 * The commands the audit found unreachable on a phone, with the label that must
 * still be what the user reads. Every one of these is hidden by a media query in
 * editor.css, so this array is the contract: add a hide rule, add a row here.
 */
const PHONE_REQUIRED: Array<[id: string, label: string]> = [
  ['redo', '重做'],
  ['colorDefault', '默认颜色'],
  ['highlightClear', '清除高亮'],
  ['alignLeft', '左对齐'],
  ['alignCenter', '居中'],
  ['alignRight', '右对齐'],
  ['alignJustify', '两端对齐'],
  ['image', '图片'],
  ['link', '链接'],
  ['find', '查找替换'],
  ['outline', '文档大纲'],
]

test('every command the phone hides has a row in the more menu', () => {
  const missing: string[] = []
  for (const [id, label] of PHONE_REQUIRED) {
    assert.equal(LABELS.get(id), label, id + ' must still mean "' + label + '"')
    // Quoted id, so `link` does not match `onLink` or `tb-link`.
    if (!MENU.includes("'" + id + "'")) missing.push(label + ' (' + id + ')')
  }
  assert.deepEqual(missing, [], 'unreachable at max-width:560px: ' + missing.join(', '))
})

test('the more menu lists its sections in the contract order', () => {
  // Order matters for reach: 颜色 and 对齐 are near the top because they are the
  // two the audit called out; 历史 is last because 重做 is the rarest of them.
  const expected = ['段落', '文字', '颜色', '对齐', '列表与块', '缩进', '插入', '导航', '历史']
  const found = [...MENU.matchAll(/moreSection\('([^']+)'|className="tb-more-section">([^<]+)</g)]
    .map((match) => match[1] ?? match[2]!.trim())
  assert.deepEqual(found, expected, 'phone menu sections, in order')
})

test('colour swatches are menu items with a pressed state and a spoken name', () => {
  // A bare <button style="background:#…"> is a coloured dot with no name and no
  // state: fine with a mouse, unusable with a screen reader, and it did not
  // announce the current colour at all. The shared helper is asserted rather
  // than each palette, because the desktop popovers and the phone menu both call
  // it — fixing it there fixes every palette.
  const helper = /const swatches = \(([\s\S]*?)\n\n/.exec(TOOLBAR)
  assert.ok(helper, 'swatches() must stay one shared helper')
  assert.match(helper![0], /role="menuitem"/, 'a swatch is a choice inside a menu')
  assert.match(helper![0], /aria-pressed=\{isOn\(hex\)\}/, 'a swatch must announce whether it is the active colour')
  assert.match(helper![0], /aria-label=\{swatchLabel\(group, hex\)\}/, 'a swatch needs a name that is not just its colour')
  assert.match(helper![0], /disabled=\{disabled\}/, 'a read-only document must disable the swatches like every other row')
  // The name has to carry a human colour word, not only the hex.
  assert.match(TOOLBAR, /const COLOR_NAMES: Record<string, string> = \{/, 'the palette needs readable colour names')
})

test('the alignment, list and insert groups are generated, not retyped', () => {
  // The phone menu previously kept its own copy of the lists/insert commands. A
  // copy is how it fell behind the desktop row (no 对齐, no 颜色, no 链接), so the
  // menu is required to reach the same identifiers the row uses.
  const rowIds = [...TOOLBAR.matchAll(/^\s{2}(\w+): \{/gm)].map((match) => match[1])
  assert.ok(rowIds.length > 20, 'COMMANDS is the shared command table')
  for (const id of ['bullet', 'ordered', 'task', 'quote', 'codeBlock', 'table', 'divider', 'outdent', 'indent']) {
    assert.ok(MENU.includes("'" + id + "'"), id + ' must be reachable from the phone menu')
  }
})

test('the phone menu scrolls inside the panel and does not fight Popover.tsx', () => {
  const start = EDITOR_CSS.indexOf('@media (max-width:560px)')
  assert.ok(start >= 0, 'editor.css keeps one phone block')
  const mobile = EDITOR_CSS.slice(start)
  const menu = /\.tb-more-menu\{([^}]*)\}/.exec(mobile)
  assert.ok(menu, '.tb-more-menu must be tuned inside the phone block')
  assert.match(menu![1]!, /overflow-y:auto/, 'the menu must scroll when it is taller than the viewport')
  assert.match(menu![1]!, /overscroll-behavior:contain/, 'a flick at the end of the list must not move the document')
  // Popover.tsx writes max-height inline from the visual viewport. This cap is
  // the pre-measure fallback, so it must be a limit CSS can retreat from — never
  // `!important`, which would outrank the inline measurement and clip a short
  // menu to the wrong height.
  assert.match(menu![1]!, /max-height:min\(78dvh/, 'the fallback cap must follow the collapsing URL bar (dvh, not vh)')
  assert.ok(!/max-height[^;}]*!important/.test(menu![1]!), 'never outrank Popover.tsx’s measured max-height')
  // A flex child may shrink; without this the sections compress into the measured
  // height instead of overflowing, which looks like a menu that "fits" while its
  // rows are squashed.
  assert.match(mobile, /\.tb-more-menu\s*>\s*\*\{flex:none\}/, 'the sections must not be shrinkable')
  assert.match(mobile, /\.tb-more-menu \.tb-menu-item\{min-height:44px/, 'phone rows are 44px touch targets')
})

test('the phone row keeps exactly undo, block style, bold, insert and more', () => {
  const start = EDITOR_CSS.indexOf('@media (max-width:560px)')
  const mobile = EDITOR_CSS.slice(start)
  // The row is the groups that are NOT hidden. Each remaining control is named
  // by the selector that hides its siblings, so this doubles as documentation of
  // what the phone keeps: one history button, one inline mark, one insert action,
  // and the menu trigger.
  assert.match(mobile, /\.tb-group-history \.tb-btn:not\(:first-child\)/, 'history keeps 撤销 only; 重做 moves to the menu')
  assert.match(mobile, /\.tb-group-inline \.tb-btn:not\(:first-child\)/, 'inline keeps 加粗 only')
  assert.match(mobile, /\.tb-group-insert > \.tb-btn:not\(:first-child\)/, 'insert keeps the first action (图片) only')
  assert.match(mobile, /\.tb-group-insert > \.tb-anchor/, 'the insert chevron must not survive as a dead expander')
  // The block group keeps its first anchor (段落样式) and loses the second (字号).
  assert.match(mobile, /\.tb-group-block > \.tb-anchor:last-child/, 'the size select leaves the phone row')
  for (const group of ['tb-group-color', 'tb-group-list', 'tb-group-extra']) {
    const rule = new RegExp('\\.' + group + '\\s*(?:\\{|,)')
    assert.match(mobile, rule, group + ' must be hidden on a phone')
  }
  assert.match(mobile, /\.tb-more\{display:flex\}/, 'the menu itself must be visible at 560px')
})

test('the phone row is documented as relocated, not deleted', () => {
  // The next person to add a command will read the hide rule. If it does not say
  // where the hidden group went, "hide it here too" is the obvious next edit.
  const start = EDITOR_CSS.indexOf('@media (max-width:560px)')
  const mobile = EDITOR_CSS.slice(start)
  assert.match(mobile, /Relocated to `?\.tb-more`?/, 'the phone block must say where the commands went')
})
