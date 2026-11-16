import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')
const readStyle = (name: string) => readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Two invariants that were both silent in the UI and only visible in a browser:
 * a menu that fits still showed scrollbars, and one destination was reachable
 * from several places in the sidebar. Neither throws, neither looks broken in a
 * unit test, and both are cheap to reintroduce — so they are pinned here.
 */

test('a menu that fits never paints a scrollbar', () => {
  // .popover is a scroll container (overflow-y:auto). Its decorative frame is an
  // ::after at inset:-1px, which is correct for a button but adds one pixel to
  // both scroll extents inside a scrollport. Measured at 1280x900 before the fix:
  // client 228x298, scroll 229x299 — a scrollbar on a menu that fit completely.
  const layout = readStyle('layout.css')
  const override = /:root :is\(\.popover,\.creation-menu\)\.sketch-frame::after\{inset:0\}/.exec(layout)
  assert.ok(override, 'the popover frame must inset by 0, not -1px, or it scrolls by 1px')
  // It has to win by coming after the generic rule, not by !important: the
  // button case still needs the -1px so its frame can overlap its own edge.
  const generic = layout.search(/\.sketch-frame::after\{[^}]*inset:-1px/)
  assert.ok(generic >= 0, 'buttons keep the -1px frame')
  assert.ok(generic < override!.index, 'the popover override must come after the generic frame rule')
})

test('menus scroll on one axis only', () => {
  // `overflow-y:auto` with a visible `overflow-x` computes to `auto` on both
  // axes, so a single overhanging pixel produced a horizontal scrollbar under a
  // menu that was already tall enough to need the vertical one.
  const surfaces = readStyle('surfaces.css')
  const popover = /\.popover\{([^}]*)\}/.exec(surfaces)
  assert.ok(popover, '.popover must be defined in surfaces.css')
  assert.match(popover![1]!, /overflow-x:hidden/, 'a menu must not scroll horizontally')
  assert.match(popover![1]!, /overflow-y:auto/, 'a tall menu still scrolls vertically')
})

test('every sidebar destination has exactly one entry point', () => {
  // The workspace popover used to repeat 管理中心, 快捷键与帮助 and 退出登录 —
  // all three already present in the same column, 90px away.
  const sidebar = read('components/layout/Sidebar.tsx')
  const labels = [...sidebar.matchAll(/>([\u4e00-\u9fff]{2,8})</g)].map((match) => match[1]!)
  const destinations = labels.filter((label) => ['管理中心', '回收站', '模板库', '首页', '最近', '收藏'].includes(label))
  const duplicates = destinations.filter((label, index) => destinations.indexOf(label) !== index)
  assert.deepEqual(duplicates, [], 'a destination must appear once in the sidebar: ' + duplicates.join(', '))
  assert.ok(!sidebar.includes('workspace-menu'), 'the duplicating workspace popover must stay removed')
})

test('the tree root row opens the document list, not the dashboard', () => {
  // "所有文档" called onHome, so the sidebar had two buttons for the dashboard
  // while nothing opened the flat list the label named.
  const sidebar = read('components/layout/Sidebar.tsx')
  const root = /className=\{?'root-folder'?[^>]*onClick=\{props\.onAllDocuments\}/
  assert.match(sidebar, root, 'the root row must call onAllDocuments')
  const rootBlock = sidebar.slice(sidebar.indexOf('root-folder'), sidebar.indexOf('root-folder') + 900)
  assert.ok(!/onClick=\{props\.onHome\}/.test(rootBlock), 'the root row must not fall back to the dashboard')
})

test('the top bar names the screen that is mounted', () => {
  // It used to resolve to "所有文档" for every dashboard-family view, so the
  // trash, favourites and home screens all announced the same wrong name.
  const app = read('App.tsx')
  assert.match(app, /const VIEW_TITLES: Record<HomeView, string>/)
  assert.match(app, /title=\{active\?\.title \|\| selectedFolder\?\.title \|\| VIEW_TITLES\[homeView\]/)
})
