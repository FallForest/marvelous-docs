import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import StatsCards from '../src/components/ui/StatsCards'

test('workspace statistic variants cannot inherit document comment or folder styles', () => {
  const markup = renderToStaticMarkup(createElement(StatsCards, {
    stats: { documents: 24, folders: 6, members: 3, openComments: 2, trashed: 0 },
  }))
  const cards = [...markup.matchAll(/class="(stat-card [^"]+)"/g)].map((match) => match[1]!.split(' '))
  assert.equal(cards.length, 5)
  for (const classes of cards) {
    assert.ok(classes.every((name) => name === 'stat-card' || name.startsWith('stat-')),
      'a bare comment/folder class would apply unrelated panel geometry: ' + classes.join(' '))
  }
  assert.ok(cards.some((classes) => classes.includes('stat-comment')))
  assert.ok(markup.includes('待处理评论'))
})

test('unavailable statistics keep the same five card and icon slots', () => {
  const markup = renderToStaticMarkup(createElement(StatsCards, { stats: null }))
  assert.equal([...markup.matchAll(/class="stat-card /g)].length, 5)
  assert.equal([...markup.matchAll(/class="stat-icon"/g)].length, 5)
  assert.equal([...markup.matchAll(/<b>—<\/b>/g)].length, 5)
})
