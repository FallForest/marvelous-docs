import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDocHTML } from '../src/lib/export/render-html'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const task = (checked: unknown, content: Record<string, unknown>[] = [p('任务')]) => ({ type: 'taskItem', attrs: { checked }, content })
const list = (...content: Record<string, unknown>[]) => ({ type: 'taskList', content })

test('static task items preserve true, false and missing completion as disabled native checkboxes', () => {
  for (const checked of [true, false, undefined]) {
    const node = checked === undefined ? { type: 'taskItem', content: [p('缺省任务')] } : task(checked)
    const html = renderDocHTML(list(node))
    assert.equal((html.match(/type="checkbox"/g) || []).length, 1)
    assert.match(html, /<input type="checkbox" disabled(?: checked)? aria-label="任务完成状态">/)
    assert.equal(/disabled checked/.test(html), checked === true)
    assert.ok(html.includes('data-checked="' + String(checked === true) + '"'))
    assert.ok(!html.includes('contenteditable') && !html.includes('onclick') && !html.includes('tabindex'))
  }
})

test('nested task state is preserved independently of the parent and sibling items', () => {
  const html = renderDocHTML(list(
    task(true, [p('父任务'), list(task(false, [p('子任务未完成')]), task(true, [p('子任务已完成')]))]),
    task(false, [p('同级任务')]),
  ))
  assert.deepEqual([...html.matchAll(/data-checked="(true|false)"/g)].map(match => match[1]), ['true', 'false', 'true', 'false'])
  assert.equal((html.match(/type="checkbox" disabled/g) || []).length, 4)
  assert.equal((html.match(/disabled checked/g) || []).length, 2)
  assert.match(html, /<div class="task-item-content"><p>父任务<\/p><ul class="task-list">/)
  assert.match(html, /子任务已完成<\/p><\/div><\/li><\/ul><\/div><\/li>/)
})

test('only a boolean true creates checked state and task text remains escaped', () => {
  for (const value of ['true', 'checked" onclick="alert(1)', 1, null, {}]) {
    const html = renderDocHTML(list(task(value, [p('<img src=x onerror=alert(1)>')])))
    assert.ok(!html.includes('disabled checked'))
    assert.match(html, /data-checked="false"/)
    assert.ok(!html.includes('onclick') && !html.includes('<img'))
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  }
})

test('static task HTML contains document semantics without hand-drawn UI assets or editor classes', () => {
  const html = renderDocHTML(list(task(true)))
  assert.ok(!html.includes('/art/') && !html.includes('tiptap-content') && !html.includes('shared-readonly'))
  assert.match(html, /^<ul class="task-list">/)
})
