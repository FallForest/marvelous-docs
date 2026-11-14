import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mergeTemplates, templateLabel } from '../src/components/layout/TemplateMenu'
import TemplateLibrary from '../src/components/dialogs/TemplateLibrary'
import type { Template } from '../src/lib/types'

test('an unavailable template catalogue offers no fabricated presets', () => {
  assert.deepEqual(mergeTemplates([]), [])
  assert.deepEqual(mergeTemplates([{ id: 'blank', name: 'Blank document' }]), [])
})

test('a partial catalogue only exposes ids advertised by the server', () => {
  const supplied: Template = { id: 'weekly-report', name: 'Weekly report', description: 'Server description' }
  const result = mergeTemplates([supplied])
  assert.deepEqual(result, [supplied])
  assert.equal(result[0], supplied, 'template metadata is retained rather than replaced by a local placeholder')
})

test('duplicate ids are removed and additional server templates remain reachable', () => {
  const supplied: Template[] = [
    { id: 'release-notes', name: 'Release notes' },
    { id: 'reading-notes', name: 'Reading notes' },
    { id: 'meeting-notes', name: 'Meeting notes' },
    { id: 'reading-notes', name: 'Duplicate reading notes' },
    { id: 'release-notes', name: 'Duplicate release notes' },
    { id: 'blank', name: 'Blank' },
  ]
  const before = supplied.map((entry) => ({ ...entry }))
  assert.deepEqual(mergeTemplates(supplied).map((entry) => [entry.id, entry.name]), [
    ['meeting-notes', 'Meeting notes'],
    ['release-notes', 'Release notes'],
    ['reading-notes', 'Reading notes'],
  ])
  assert.deepEqual(supplied, before, 'sorting does not mutate API data')
})

test('template titles remain localized with a server-name fallback', () => {
  assert.equal(templateLabel('weekly-report', 'Weekly report'), '周报')
  assert.equal(templateLabel('reading-notes', '阅读笔记'), '阅读笔记')
  assert.equal(templateLabel('unknown'), '未命名文档')
})

test('the independent library handles an empty catalogue without advertising presets', () => {
  const markup = renderToStaticMarkup(createElement(TemplateLibrary, {
    templates: [], onCreateTemplate: () => {}, onClose: () => {},
  }))
  assert.ok(markup.includes('暂无可用模板'))
  assert.ok(!markup.includes('template-library-card sketch-frame'))
  assert.ok(!markup.includes('会议纪要'))
  assert.ok(!markup.includes('周报'))
})

test('the independent library renders each advertised template once and retains unknown templates', () => {
  const markup = renderToStaticMarkup(createElement(TemplateLibrary, {
    templates: [
      { id: 'blank', name: '空白' },
      { id: 'weekly-report', name: 'Weekly report' },
      { id: 'reading-notes', name: '阅读笔记', description: '摘录与思考' },
      { id: 'reading-notes', name: '重复笔记' },
    ],
    onCreateTemplate: () => {}, onClose: () => {},
  }))
  assert.equal([...markup.matchAll(/class="template-library-card sketch-frame"/g)].length, 2)
  assert.ok(markup.includes('周报'))
  assert.ok(markup.includes('阅读笔记'))
  assert.ok(markup.includes('摘录与思考'))
  assert.ok(!markup.includes('重复笔记'))
  assert.ok(!markup.includes('保存我的模板'))
})
