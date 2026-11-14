import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPopoverPosition } from '../src/components/ui/Popover'

test('a short menu uses its natural height above an anchor near the viewport bottom', () => {
  const position = getPopoverPosition({
    anchor: { left: 151, right: 280, top: 610, bottom: 654, width: 129 },
    panel: { width: 236, height: 110 },
    viewport: { left: 0, top: 0, width: 375, height: 667 },
    align: 'right',
  })
  assert.equal(position.placement, 'above')
  assert.equal(position.left, 44)
  assert.equal(position.width, 236)
  assert.equal(position.top, 494)
  assert.ok(position.maxHeight >= 110)
})

test('a cramped viewport permits only the space available rather than forcing a 120px minimum', () => {
  const position = getPopoverPosition({
    anchor: { left: 151, right: 280, top: 80, bottom: 120, width: 129 },
    panel: { width: 236, height: 110 },
    viewport: { left: 0, top: 0, width: 375, height: 200 },
    align: 'right',
  })
  assert.equal(position.maxHeight, 66)
  assert.equal(position.top, 126)
  assert.equal(position.top + position.maxHeight, 192)
})

test('an oversized anchor cannot force the menu past the viewport edges', () => {
  const position = getPopoverPosition({
    anchor: { left: -80, right: 520, top: 120, bottom: 160, width: 600 },
    panel: { width: 236, height: 110 },
    viewport: { left: 0, top: 0, width: 375, height: 420 },
    align: 'right',
  })
  assert.equal(position.minWidth, 359)
  assert.equal(position.width, 359)
  assert.equal(position.maxWidth, 359)
  assert.equal(position.left, 8)
})

test('zoom converts viewport positions and bounds into the portal CSS coordinate system', () => {
  const position = getPopoverPosition({
    anchor: { left: 188.75, right: 350, top: 153, bottom: 208, width: 161.25 },
    panel: { width: 295, height: 137.5 },
    viewport: { left: 0, top: 0, width: 375, height: 420 },
    align: 'right', scale: 1.25,
  })
  assert.equal(position.left * 1.25, 55)
  assert.equal(position.width * 1.25, 295)
  assert.equal(position.top * 1.25, 214)
  assert.equal(position.minWidth, 129)
  assert.equal(position.maxWidth * 1.25, 359)
})

test('a panned visual viewport supplies its own visible edges', () => {
  const position = getPopoverPosition({
    anchor: { left: 100, right: 229, top: 270, bottom: 310, width: 129 },
    panel: { width: 236, height: 110 },
    viewport: { left: 70, top: 200, width: 260, height: 250 },
    align: 'left',
  })
  assert.equal(position.left, 86)
  assert.equal(position.top, 316)
  assert.equal(position.maxHeight, 126)
})
