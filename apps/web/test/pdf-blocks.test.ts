import { test } from 'node:test'
import assert from 'node:assert/strict'
import { A4, PDF_CONTENT_HEIGHT, PDF_CONTENT_WIDTH, PDF_MARGIN, folioLabel, pdfFilename, slicePages } from '../src/lib/pdf-pages'
import { afterBlock, blockSpans, dropTargetBefore, endOfBlocks, neighbourTarget, planMove } from '../src/lib/blocks'

/* ------------------------------------------------------------------ */
/* PDF pagination                                                      */
/* ------------------------------------------------------------------ */

test('A4 content box is the page minus the margins', () => {
  assert.equal(PDF_CONTENT_WIDTH, A4.width - PDF_MARGIN.left - PDF_MARGIN.right)
  assert.equal(PDF_CONTENT_HEIGHT, A4.height - PDF_MARGIN.top - PDF_MARGIN.bottom)
});

test('slices a canvas into page-height strips without losing a row', () => {
  const width = 1588
  const height = 5000
  const { slices, ratio, sliceHeightPx } = slicePages(width, height)

  // The image is scaled to the content width, so a slice keeps the aspect ratio.
  assert.ok(Math.abs(ratio - PDF_CONTENT_WIDTH / width) < 1e-9)
  assert.ok(sliceHeightPx > 0)
  // Every pixel row belongs to exactly one slice, in order.
  let cursor = 0
  for (const slice of slices) {
    assert.equal(slice.y, cursor)
    assert.ok(slice.height > 0)
    cursor += slice.height
  }
  assert.equal(cursor, height)
  // No slice is taller than a page.
  for (const slice of slices) assert.ok(slice.heightPt <= PDF_CONTENT_HEIGHT + 1e-9)
});

test('a canvas shorter than a page yields exactly one slice', () => {
  const { slices } = slicePages(800, 200)
  assert.equal(slices.length, 1)
  assert.equal(slices[0]!.y, 0)
  assert.equal(slices[0]!.height, 200)
});

test('an empty canvas still yields one page, so the download opens', () => {
  const { slices } = slicePages(800, 0)
  assert.equal(slices.length, 1)
  assert.ok(slices[0]!.height > 0)
  const blank = slicePages(0, 0)
  assert.equal(blank.slices.length, 1)
});

test('an exactly-one-page canvas does not add a blank trailing page', () => {
  const width = 1000
  const onePagePx = Math.floor(PDF_CONTENT_HEIGHT / (PDF_CONTENT_WIDTH / width))
  const { slices } = slicePages(width, onePagePx)
  assert.equal(slices.length, 1)
});

test('folios read "page / total"', () => {
  assert.equal(folioLabel(3, 7), '3 / 7')
});

test('the file name is safe and always ends in .pdf', () => {
  assert.equal(pdfFilename('Quarterly / plan: Q3'), 'Quarterly plan Q3.pdf')
  assert.equal(pdfFilename('   '), 'document.pdf')
  assert.equal(pdfFilename('a\\b*c?d"e<f>g|h'), 'a b c d e f g h.pdf')
  assert.ok(pdfFilename('报告').endsWith('.pdf'))
});

/* ------------------------------------------------------------------ */
/* Block moves                                                         */
/* ------------------------------------------------------------------ */

// Three paragraphs of size 3 (open + one character + close) and a rule of size 1.
const spans = blockSpans([3, 3, 3, 1])
// → [{0,3},{3,3},{6,3},{9,1}]

test('block spans are consecutive document positions', () => {
  assert.deepEqual(spans.map((span) => span.pos), [0, 3, 6, 9])
  assert.equal(endOfBlocks(spans), 10)
});

test('a drop inside a block targets that block', () => {
  assert.equal(dropTargetBefore(spans, 0), 0)
  assert.equal(dropTargetBefore(spans, 4), 3)
  assert.equal(dropTargetBefore(spans, 8), 6)
  // At or past the end is the append case.
  assert.equal(dropTargetBefore(spans, 10), null)
  assert.equal(dropTargetBefore(spans, 12), null)
});

test('moving a block down re-inserts it after its target', () => {
  // Lift the first block (0..3) and drop it before what was the third (pos 6).
  const plan = planMove(spans, 0, 6)
  assert.deepEqual(plan, { deleteFrom: 0, deleteTo: 3, insertAt: 3 })
  // Applying that to [A B C D] gives [B A C D]: A landed after B, which is
  // where the pointer was pointing (the top edge of C).
  assert.equal(plan!.insertAt, 3)
});

test('moving a block up shifts nothing', () => {
  // Lift C (6..9) and drop it before A (0).
  assert.deepEqual(planMove(spans, 6, 0), { deleteFrom: 6, deleteTo: 9, insertAt: 0 })
});

test('a drop on itself, or on the gap right after itself, is a no-op', () => {
  assert.equal(planMove(spans, 3, 3), null)
  // The top edge of the block following the dragged one is the same place.
  assert.equal(planMove(spans, 3, 6), null)
});

test('appending moves a block to the end', () => {
  // After the delete the body is 7 characters long, so the end is 7 — not the
  // original 10, which would be past the end of the shortened document.
  assert.deepEqual(planMove(spans, 0, null), { deleteFrom: 0, deleteTo: 3, insertAt: 7 })
  // The last block is already at the end.
  assert.equal(planMove(spans, 9, null), null)
});

test('unknown positions produce no plan instead of a corrupt transaction', () => {
  assert.equal(planMove(spans, 4, 0), null)
  assert.equal(planMove(spans, 0, 4), null)
});

test('the neighbour target stops at the edges', () => {
  assert.equal(neighbourTarget(spans, 0, -1), null)
  assert.equal(neighbourTarget(spans, 0, 1), 3)
  assert.equal(neighbourTarget(spans, 6, -1), 3)
  assert.equal(neighbourTarget(spans, 9, 1), null)
});

test('"insert below" returns the position just after the block', () => {
  assert.equal(afterBlock(spans, 0), 3)
  assert.equal(afterBlock(spans, 9), 10)
  assert.equal(afterBlock(spans, 7), null)
});
