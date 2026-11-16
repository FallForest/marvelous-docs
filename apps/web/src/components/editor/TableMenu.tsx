import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Grid2X2, Rows3, Table2, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { BlockGeometry } from '../../hooks/useBlockGeometry'
import { visualViewportRect } from '../../lib/viewport'
import Popover from '../ui/Popover'

/**
 * Table actions, anchored to the table the cursor is in.
 *
 * Previously this was a permanent button pinned to the bottom-right of the
 * canvas (`right:24px; bottom:52px`), which in a long document sat hundreds of
 * pixels away from the table being edited. It now rides on the table's own rect
 * and only appears while the cursor is inside a table.
 *
 * Motion: the trigger and the panel both live at coordinates that are
 * recomputed as the document scrolls, so the panel's entrance is the shared
 * .motion-rise animation (plays once on mount) rather than a transition, which
 * would re-fire on every re-measure. The rows stay still on hover; only their
 * ground changes colour.
 */
export default function TableMenu({ editor, table }: { editor: Editor | null; table: BlockGeometry | null }) {
  const [open, setOpen] = useState(false)
  if (!editor || !editor.isEditable || !table || !editor.isActive('table')) return null
  /*
   * Placement must only refer to *this* table.
   *
   * `table` is resolved by DocumentEditor from the selection (activeTable), not
   * from the first table in the viewport, so the anchor and the command now
   * share one object. This guard is the second half: if the measured rect is for
   * a node that no longer exists at that position — a collaborator deleted the
   * table, or a sync replaced the body — the bar would hover over unrelated text
   * and its buttons would still call table commands on the current selection.
   * Disappearing is the correct behaviour.
   */
  const measured = editor.state.doc.nodeAt(table.pos)
  if (!measured || measured.type.name !== 'table') return null

  type TableCommand = 'addRowBefore' | 'addRowAfter' | 'addColumnBefore' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'mergeCells' | 'splitCell' | 'toggleHeaderRow' | 'toggleHeaderColumn' | 'toggleHeaderCell' | 'deleteTable'
  const actions: Array<{ label: string; icon: React.ReactNode; command: TableCommand; danger?: boolean }> = [
    { label: '上方插入行', icon: <ArrowUp size={15} />, command: 'addRowBefore' },
    { label: '下方插入行', icon: <ArrowDown size={15} />, command: 'addRowAfter' },
    { label: '左侧插入列', icon: <ArrowLeft size={15} />, command: 'addColumnBefore' },
    { label: '右侧插入列', icon: <ArrowRight size={15} />, command: 'addColumnAfter' },
    { label: '删除行', icon: <Rows3 size={15} />, command: 'deleteRow', danger: true },
    { label: '删除列', icon: <Columns3 size={15} />, command: 'deleteColumn', danger: true },
    { label: '合并单元格', icon: <Grid2X2 size={15} />, command: 'mergeCells' },
    { label: '拆分单元格', icon: <Grid2X2 size={15} />, command: 'splitCell' },
    { label: '切换表头行', icon: <Rows3 size={15} />, command: 'toggleHeaderRow' },
    { label: '切换表头列', icon: <Columns3 size={15} />, command: 'toggleHeaderColumn' },
    { label: '切换表头单元格', icon: <Grid2X2 size={15} />, command: 'toggleHeaderCell' },
    { label: '删除表格', icon: <Trash2 size={15} />, command: 'deleteTable', danger: true },
  ]

  /*
   * Sits just above the table's top-right corner, clamped into the *visual*
   * viewport. `innerHeight` does not shrink when a phone keyboard opens, so a
   * bar clamped against the window can land under the keyboard where it cannot
   * be tapped. The trigger is 30px tall, hence the 38px margin below the top of
   * the table when there is no room above.
   */
  const view = visualViewportRect()
  const top = Math.max(view.top + 8, Math.min(table.top - 34, view.top + view.height - 38))
  const left = Math.max(view.left + 8, Math.min(table.right - 96, view.left + view.width - 104))

  return <div className="block-tool" style={{ top, left }} contentEditable={false}>
      <button
        type="button"
        className={'block-tool-trigger' + (open ? ' is-open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        title="表格操作"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      ><Table2 size={13} /><span>表格</span></button>
      <Popover open={open} onClose={() => setOpen(false)} label="表格操作" align="right" className="tb-menu">
        {actions.map((action) => <button key={action.command} type="button" role="menuitem"
          disabled={!editor.can()[action.command]()}
          className={'tb-menu-item' + (action.danger ? ' danger' : '')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { editor.chain().focus()[action.command]().run(); setOpen(false) }}
        >{action.icon}<span>{action.label}</span></button>)}
      </Popover>
    </div>
}
