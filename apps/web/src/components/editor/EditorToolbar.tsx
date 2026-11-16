import { useRef, useState } from 'react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, ChevronDown, Code2, Highlighter,
  ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, ListTodo, MessageCircle,
  Minus, MoreHorizontal, Palette, Quote, Redo2, Search, Strikethrough, Table2, Type, Underline, Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import Popover from '../ui/Popover'
import { createFocusReturn } from '../../lib/focus'
import { changeBlockIndent } from '../../lib/editor/tab-in-prose'

export type ToolbarActions = {
  onLink: () => void
  onImage: () => void
  onFind: () => void
  onOutline: () => void
  onComment: () => void
}

/**
 * One formatting command, declared once.
 *
 * The desktop row, the desktop popovers and the phone "更多" menu all resolve
 * their rows from `COMMANDS`: a label, an icon or a command cannot drift between
 * the surface a mouse sees and the one a thumb sees. The phone menu decides
 * *which* commands sit in *which* section; it never re-implements what a command
 * does.
 */
type Command = {
  /** The only copy of this string in the file; every surface reads it here. */
  label: string
  icon?: LucideIcon
  run: (editor: Editor | null, actions: ToolbarActions) => void
  /** Toggle state; when present the control renders active + aria-pressed. */
  isActive?: (editor: Editor | null) => boolean
  /** False disables the control (nothing to undo, nothing to outdent). */
  isAvailable?: (editor: Editor | null) => boolean
}

const indentCommand = (direction: 1 | -1) => (editor: Editor | null) => editor?.chain().focus()
  .command(({ state, dispatch }) => changeBlockIndent(direction)(state, dispatch)).run()
const canIndent = (direction: 1 | -1) => (editor: Editor | null) =>
  !!editor?.isEditable && changeBlockIndent(direction)(editor.state)

const COMMANDS = {
  undo: {
    label: '撤销', icon: Undo2,
    run: (editor) => editor?.chain().focus().undo().run(),
    isAvailable: (editor) => !!editor?.can().undo(),
  },
  redo: {
    label: '重做', icon: Redo2,
    run: (editor) => editor?.chain().focus().redo().run(),
    isAvailable: (editor) => !!editor?.can().redo(),
  },

  paragraph: { label: '正文', run: (editor) => editor?.chain().focus().setParagraph().run() },
  h1: { label: '标题 1', run: (editor) => editor?.chain().focus().toggleHeading({ level: 1 }).run() },
  h2: { label: '标题 2', run: (editor) => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
  h3: { label: '标题 3', run: (editor) => editor?.chain().focus().toggleHeading({ level: 3 }).run() },

  bold: {
    label: '加粗', icon: Bold,
    run: (editor) => editor?.chain().focus().toggleBold().run(),
    isActive: (editor) => !!editor?.isActive('bold'),
  },
  italic: {
    label: '斜体', icon: Italic,
    run: (editor) => editor?.chain().focus().toggleItalic().run(),
    isActive: (editor) => !!editor?.isActive('italic'),
  },
  underline: {
    label: '下划线', icon: Underline,
    run: (editor) => editor?.chain().focus().toggleUnderline().run(),
    isActive: (editor) => !!editor?.isActive('underline'),
  },
  strike: {
    label: '删除线', icon: Strikethrough,
    run: (editor) => editor?.chain().focus().toggleStrike().run(),
    isActive: (editor) => !!editor?.isActive('strike'),
  },
  code: {
    label: '行内代码', icon: Code2,
    run: (editor) => editor?.chain().focus().toggleCode().run(),
    isActive: (editor) => !!editor?.isActive('code'),
  },

  colorDefault: { label: '默认颜色', run: (editor) => editor?.chain().focus().unsetColor().run() },
  highlightClear: { label: '清除高亮', run: (editor) => editor?.chain().focus().unsetHighlight().run() },

  alignLeft: {
    label: '左对齐', icon: AlignLeft,
    run: (editor) => editor?.chain().focus().setTextAlign('left').run(),
    isActive: (editor) => !!editor?.isActive({ textAlign: 'left' }),
  },
  alignCenter: {
    label: '居中', icon: AlignCenter,
    run: (editor) => editor?.chain().focus().setTextAlign('center').run(),
    isActive: (editor) => !!editor?.isActive({ textAlign: 'center' }),
  },
  alignRight: {
    label: '右对齐', icon: AlignRight,
    run: (editor) => editor?.chain().focus().setTextAlign('right').run(),
    isActive: (editor) => !!editor?.isActive({ textAlign: 'right' }),
  },
  alignJustify: {
    label: '两端对齐', icon: AlignJustify,
    run: (editor) => editor?.chain().focus().setTextAlign('justify').run(),
    isActive: (editor) => !!editor?.isActive({ textAlign: 'justify' }),
  },

  bullet: {
    label: '项目符号列表', icon: List,
    run: (editor) => editor?.chain().focus().toggleBulletList().run(),
    isActive: (editor) => !!editor?.isActive('bulletList'),
  },
  ordered: {
    label: '编号列表', icon: ListOrdered,
    run: (editor) => editor?.chain().focus().toggleOrderedList().run(),
    isActive: (editor) => !!editor?.isActive('orderedList'),
  },
  task: {
    label: '任务列表', icon: ListTodo,
    run: (editor) => editor?.chain().focus().toggleTaskList().run(),
    isActive: (editor) => !!editor?.isActive('taskList'),
  },
  quote: {
    label: '引用', icon: Quote,
    run: (editor) => editor?.chain().focus().toggleBlockquote().run(),
    isActive: (editor) => !!editor?.isActive('blockquote'),
  },
  codeBlock: {
    label: '代码块', icon: Code2,
    run: (editor) => editor?.chain().focus().toggleCodeBlock().run(),
    isActive: (editor) => !!editor?.isActive('codeBlock'),
  },

  outdent: { label: '减少缩进', icon: IndentDecrease, run: indentCommand(-1), isAvailable: canIndent(-1) },
  indent: { label: '增加缩进', icon: IndentIncrease, run: indentCommand(1), isAvailable: canIndent(1) },

  image: { label: '图片', icon: ImagePlus, run: (_editor, actions) => actions.onImage() },
  link: {
    label: '链接', icon: Link2,
    run: (_editor, actions) => actions.onLink(),
    isActive: (editor) => !!editor?.isActive('link'),
  },
  table: {
    label: '表格', icon: Table2,
    run: (editor) => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    isActive: (editor) => !!editor?.isActive('table'),
  },
  divider: { label: '分割线', icon: Minus, run: (editor) => editor?.chain().focus().setHorizontalRule().run() },
  hardBreak: { label: '换行符', icon: Type, run: (editor) => editor?.chain().focus().setHardBreak().run() },

  find: { label: '查找替换', icon: Search, run: (_editor, actions) => actions.onFind() },
  outline: { label: '文档大纲', icon: ListOrdered, run: (_editor, actions) => actions.onOutline() },

  comment: { label: '评论', icon: MessageCircle, run: (_editor, actions) => actions.onComment() },
} satisfies Record<string, Command>

type CommandId = keyof typeof COMMANDS

/*
 * The arrays below are the only difference between the desktop row and the phone
 * menu: same commands, different arrangement. CSS then decides which groups the
 * phone row keeps (styles/editor.css, max-width:560px) and which groups it
 * relocates into .tb-more.
 */
const HISTORY_IDS: CommandId[] = ['undo', 'redo']
const INLINE_IDS: CommandId[] = ['bold', 'italic', 'underline', 'strike', 'code']
const ALIGN_IDS: CommandId[] = ['alignLeft', 'alignCenter', 'alignRight', 'alignJustify']
const LIST_IDS: CommandId[] = ['bullet', 'ordered', 'task', 'quote', 'codeBlock']
/**
 * 图片 comes first because it is the one insert action the phone row keeps:
 * editor.css hides `.tb-group-insert .tb-btn:nth-of-type(n+2)`, which is only the
 * right button if this array starts with the upload action.
 */
const INSERT_IDS: CommandId[] = ['image', 'link', 'table']
/** The desktop chevron submenu of the insert group; the phone menu lists them flat. */
const INSERT_MENU_IDS: CommandId[] = ['divider', 'hardBreak']
const NAV_IDS: CommandId[] = ['find', 'outline']
const EXTRA_IDS: CommandId[] = ['comment', 'outdent', 'indent']

const BLOCK_OPTIONS: Array<{ command: CommandId; hint: string }> = [
  { command: 'paragraph', hint: '普通段落' },
  { command: 'h1', hint: '大标题' },
  { command: 'h2', hint: '章节标题' },
  { command: 'h3', hint: '小节标题' },
]

const FONT_SIZES = [
  { value: '12px', label: '12' }, { value: '14px', label: '14' }, { value: '16px', label: '16' },
  { value: '18px', label: '18' }, { value: '22px', label: '22' }, { value: '28px', label: '28' },
]

const COLORS = ['#1f2937', '#5f6673', '#b0453a', '#c0533f', '#b07a2b', '#3d7a54', '#2f6fb3', '#7a4fb3', '#b3447a']
const HIGHLIGHTS = ['#fff3c4', '#ffe1d6', '#e2f3e7', '#e2ecfb', '#f3e6fb', '#f7f1e1']

/**
 * Human names for the palette. A phone renders a swatch as a coloured circle with
 * no text, so its accessible name has to carry the colour: a hex code alone is
 * unusable with a screen reader and unhelpful to anyone who cannot see the dot.
 */
const COLOR_NAMES: Record<string, string> = {
  '#1f2937': '石墨', '#5f6673': '石灰', '#b0453a': '砖红', '#c0533f': '陶土', '#b07a2b': '赭黄',
  '#3d7a54': '松绿', '#2f6fb3': '靛蓝', '#7a4fb3': '紫藤', '#b3447a': '玫红',
  '#fff3c4': '奶黄', '#ffe1d6': '蜜桃', '#e2f3e7': '薄荷', '#e2ecfb': '天青', '#f3e6fb': '丁香', '#f7f1e1': '米白',
}
const swatchLabel = (group: string, hex: string) => group + ' ' + (COLOR_NAMES[hex] || hex) + ' ' + hex

/** The block style at the caret, as a command id so its label is not copied. */
function currentBlock(editor: Editor): CommandId {
  if (editor.isActive('heading', { level: 1 })) return 'h1'
  if (editor.isActive('heading', { level: 2 })) return 'h2'
  if (editor.isActive('heading', { level: 3 })) return 'h3'
  return 'paragraph'
}

/**
 * Feishu-style grouped formatting toolbar.
 *
 * All motion lives in styles/editor.css: press feedback is :active only, the
 * active-state ground springs in, and menu panels animate from the shared
 * popover keyframes. The markup therefore stays declarative — no per-button
 * animation state is tracked here, so a re-render caused by the document does
 * not restart anything.
 */
export default function EditorToolbar({ editor, actions, onInteract }: { editor: Editor | null; actions: ToolbarActions; onInteract?: () => void }) {
  const [blockOpen, setBlockOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const disabled = !editor?.isEditable
  const command = (id: CommandId): Command => COMMANDS[id]
  /** One rule for every surface: a read-only document disables rows and swatches alike. */
  const blocked = (id: CommandId) => {
    const availability = command(id).isAvailable
    return disabled || (availability ? !availability(editor) : false)
  }
  const activeTextColor = (editor?.getAttributes('textStyle').color as string) || '#1f2937'
  const highlightColor = editor?.getAttributes('highlight').color as string | undefined
  const activeSize = editor?.getAttributes('textStyle').fontSize || '16px'

  /*
   * Focus-return contract (CONTRACTS.md §4). The menu panels are portalled to
   * <body> and their rows are unmounted on close, so without this focus lands on
   * <body> and the next keystroke goes nowhere. `lib/focus.ts` is the batch's one
   * implementation of the contract — recording on open, and falling back to the
   * editor surface when the recorded trigger is gone — so this file only decides
   * *when* to record and restore, never how.
   *
   * The restore is deferred by one task because the closing panel still owns
   * focus at click time: `document.activeElement` is the row we are about to
   * remove, and `chooseFocusReturn` would (correctly) read that as "focus is
   * inside the overlay, so treat it as destroyed". After the commit the row is
   * gone, activeElement is <body>, and the recorded trigger is still usable.
   */
  const focusReturnRef = useRef<ReturnType<typeof createFocusReturn> | null>(null)
  if (!focusReturnRef.current) focusReturnRef.current = createFocusReturn()
  const focusReturn = focusReturnRef.current
  const restoreFocus = () => { window.setTimeout(() => { focusReturn.restore() }, 0) }
  /** Toggle a menu, recording focus only on the open edge. */
  const toggle = (open: boolean, setOpen: (next: boolean) => void) => () => {
    if (!open) focusReturn.record()
    setOpen(!open)
  }

  /** A 28px control in the desktop row (40×44 on a phone, see editor.css). */
  const tool = (id: CommandId) => {
    const { label, icon: Icon, run, isActive } = command(id)
    const active = !!isActive?.(editor)
    return <button
      key={id}
      type="button"
      className={'tb-btn' + (active ? ' is-active' : '')}
      title={label}
      aria-label={label}
      {...(isActive ? { 'aria-pressed': active } : {})}
      disabled={blocked(id)}
      onMouseDown={(event) => { event.preventDefault(); onInteract?.() }}
      onClick={() => run(editor, actions)}
    >{Icon ? <Icon size={16} /> : label}</button>
  }

  /**
   * One menu row. The desktop popovers and the phone menu share it on purpose:
   * two renderers is how the phone list fell behind the desktop row before.
   */
  const menuRow = (id: CommandId, onDone: () => void) => {
    const { label, icon: Icon, run, isActive } = command(id)
    const active = !!isActive?.(editor)
    return <button
      key={id}
      type="button"
      role="menuitem"
      className={'tb-menu-item' + (active ? ' is-active' : '')}
      {...(isActive ? { 'aria-pressed': active } : {})}
      disabled={blocked(id)}
      onClick={() => { run(editor, actions); onDone() }}
    >{Icon && <Icon size={15} />}<span>{label}</span></button>
  }

  /**
   * A colour grid. `role="menuitem"` + `aria-pressed` rather than a bare button:
   * the panel is a menu and a swatch is a toggling choice inside it, which is also
   * what makes the current colour announceable instead of merely painted.
   */
  const swatches = (group: string, hexes: string[], isOn: (hex: string) => boolean, apply: (hex: string) => void, onDone: () => void) =>
    <div className="tb-swatches" role="group" aria-label={group}>{hexes.map((hex) => <button
      key={hex}
      type="button"
      role="menuitem"
      className="tb-swatch"
      aria-label={swatchLabel(group, hex)}
      aria-pressed={isOn(hex)}
      disabled={disabled}
      style={{ background: hex }}
      onClick={() => { apply(hex); onDone() }}
    />)}</div>

  const sizeRow = (size: typeof FONT_SIZES[number]) => <button
    key={size.value}
    type="button"
    role="menuitem"
    className={'tb-menu-item' + (activeSize === size.value ? ' is-active' : '')}
    aria-pressed={activeSize === size.value}
    disabled={disabled}
    onClick={() => { editor?.chain().focus().setFontSize(size.value).run(); closeMore() }}
  ><span style={{ fontSize: size.value }}>{size.label}</span></button>

  /** A titled block of rows inside the phone menu. No row opens a second panel. */
  const moreSection = (title: string, rows: React.ReactNode) => <div className="tb-more-group" role="group" aria-label={title} key={title}>
    <div className="tb-more-section">{title}</div>
    {rows}
  </div>

  const activeBlock = editor ? currentBlock(editor) : 'paragraph'
  const closeBlock = () => { setBlockOpen(false); restoreFocus() }
  const closeSize = () => { setSizeOpen(false); restoreFocus() }
  const closeColor = () => { setColorOpen(false); restoreFocus() }
  const closeHighlight = () => { setHighlightOpen(false); restoreFocus() }
  const closeAlign = () => { setAlignOpen(false); restoreFocus() }
  const closeInsert = () => { setInsertOpen(false); restoreFocus() }
  const closeMore = () => { setMoreOpen(false); restoreFocus() }

  return <div className="editor-toolbar" role="toolbar" aria-label="格式工具" onClickCapture={(event) => { if (disabled) { event.preventDefault(); event.stopPropagation() } }} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const current = event.target as HTMLButtonElement; const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter((node) => !node.disabled && node.offsetParent !== null); const position = buttons.indexOf(current); if (position >= 0) { event.preventDefault(); const next = buttons[(position + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; next?.focus() } } }}>
    <div className="tb-group tb-group-history">
      {HISTORY_IDS.map(tool)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-block">
      <div className="tb-anchor">
        <button type="button" className="tb-select sketch-frame" disabled={disabled} aria-label="段落样式" aria-haspopup="menu" aria-expanded={blockOpen} onMouseDown={(event) => { event.preventDefault(); onInteract?.() }}
          onClick={toggle(blockOpen, setBlockOpen)}>
          <span>{command(activeBlock).label}</span><ChevronDown size={13} />
        </button>
        <Popover open={blockOpen} onClose={closeBlock} label="段落样式" align="left" className="tb-menu">
          {BLOCK_OPTIONS.map((option) => <button key={option.command} type="button" role="menuitem" className={'tb-menu-item' + (option.command === activeBlock ? ' is-active' : '')}
            aria-pressed={option.command === activeBlock}
            disabled={disabled}
            onClick={() => { command(option.command).run(editor, actions); closeBlock() }}>
            <span className={'tb-menu-preview ' + option.command}>{command(option.command).label}</span>
            <small>{option.hint}</small>
            {option.command === activeBlock && <Check size={14} />}
          </button>)}
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-select tb-size sketch-frame" disabled={disabled} aria-label="字号" aria-haspopup="menu" aria-expanded={sizeOpen} onClick={toggle(sizeOpen, setSizeOpen)}>
          <span>{activeSize.replace('px', '')}</span><ChevronDown size={12} />
        </button>
        <Popover open={sizeOpen} onClose={closeSize} label="字号" align="left" className="tb-menu tb-size-menu">
          {FONT_SIZES.map((size) => <button key={size.value} type="button" role="menuitem" className={'tb-menu-item' + (activeSize === size.value ? ' is-active' : '')}
            aria-pressed={activeSize === size.value} disabled={disabled}
            onClick={() => { editor?.chain().focus().setFontSize(size.value).run(); closeSize() }}>
            <span style={{ fontSize: size.value }}>{size.label}</span>
          </button>)}
        </Popover>
      </div>
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-inline">
      {INLINE_IDS.map(tool)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-color">
      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="文字颜色" aria-label="文字颜色" aria-haspopup="menu" aria-expanded={colorOpen} onClick={toggle(colorOpen, setColorOpen)}>
          <span className="tb-color"><Palette size={15} /><i style={{ background: activeTextColor }} /></span>
        </button>
        <Popover open={colorOpen} onClose={closeColor} label="文字颜色" align="left" className="tb-menu tb-color-menu">
          {swatches('文字颜色', COLORS, (hex) => activeTextColor === hex, (hex) => { editor?.chain().focus().setColor(hex).run() }, closeColor)}
          {menuRow('colorDefault', closeColor)}
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="高亮" aria-label="高亮" aria-haspopup="menu" aria-expanded={highlightOpen} onClick={toggle(highlightOpen, setHighlightOpen)}>
          <span className="tb-color tb-highlight"><Highlighter size={15} /><i /></span>
        </button>
        <Popover open={highlightOpen} onClose={closeHighlight} label="高亮颜色" align="left" className="tb-menu tb-color-menu">
          {swatches('高亮', HIGHLIGHTS, (hex) => highlightColor === hex, (hex) => { editor?.chain().focus().toggleHighlight({ color: hex }).run() }, closeHighlight)}
          {menuRow('highlightClear', closeHighlight)}
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="对齐" aria-label="对齐方式" aria-haspopup="menu" aria-expanded={alignOpen} onClick={toggle(alignOpen, setAlignOpen)}>
          {editor?.isActive({ textAlign: 'center' }) ? <AlignCenter size={16} /> : editor?.isActive({ textAlign: 'right' }) ? <AlignRight size={16} /> : editor?.isActive({ textAlign: 'justify' }) ? <AlignJustify size={16} /> : <AlignLeft size={16} />}
        </button>
        <Popover open={alignOpen} onClose={closeAlign} label="对齐方式" align="left" className="tb-menu tb-align-menu">
          {ALIGN_IDS.map((id) => menuRow(id, closeAlign))}
        </Popover>
      </div>
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-list">
      {LIST_IDS.map(tool)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-insert">
      {INSERT_IDS.map(tool)}
      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="更多插入" aria-label="更多插入" aria-haspopup="menu" aria-expanded={insertOpen} onClick={toggle(insertOpen, setInsertOpen)}><ChevronDown size={15} /></button>
        <Popover open={insertOpen} onClose={closeInsert} label="插入" align="right" className="tb-menu">
          {INSERT_MENU_IDS.map((id) => menuRow(id, closeInsert))}
          {NAV_IDS.map((id) => menuRow(id, closeInsert))}
        </Popover>
      </div>
    </div>

    <div className="tb-spacer" />
    <div className="tb-group tb-group-extra">
      {EXTRA_IDS.map(tool)}
    </div>

    {/*
     * Mobile only (styles/editor.css shows it at max-width:560px). On a phone the
     * row cannot hold every group, and horizontal scrolling hid 306px of it behind
     * a fade — the controls existed but were unreachable.
     *
     * The panel is flat: no row opens a second popover, so a formatting action is
     * at most one tap away. 查找替换 and 文档大纲 leave the menu to open their own
     * panel, which is why they are the only two that navigate.
     *
     * Ids are listed literally here on purpose, while labels/icons/behaviour come
     * from COMMANDS. Naming a group constant (ALIGN_IDS, LIST_IDS…) would be
     * shorter, but then "is 对齐 still reachable on a phone?" stops being readable
     * from the source and stops being pinnable by test/phone-capability.test.ts —
     * which is the one question this block exists to answer.
     */}
    <div className="tb-anchor tb-more">
      <button
        type="button"
        className={'tb-btn' + (moreOpen ? ' is-active' : '')}
        title="更多格式"
        aria-label="更多格式"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        disabled={disabled}
        onMouseDown={(event) => { event.preventDefault(); onInteract?.() }}
        onClick={toggle(moreOpen, setMoreOpen)}
      ><MoreHorizontal size={18} /></button>
      <Popover open={moreOpen} onClose={closeMore} label="更多格式" align="right" className="tb-menu tb-more-menu">
        {moreSection('段落', (['paragraph', 'h1', 'h2', 'h3'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {/*
         * 加粗 is also on the phone row, and it is listed here anyway: this section
         * is a complete text vocabulary, and a writer who opened the menu should
         * not have to close it to reach the one mark that happens to be promoted
         * to the row. Without it the group would read as a gap in 加粗 · 斜体 ·
         * 下划线 · 删除线 · 行内代码.
         */}
        {moreSection('文字', <>
          {(['bold', 'italic', 'underline', 'strike', 'code'] as CommandId[]).map((id) => menuRow(id, closeMore))}
          {/* 字号 travels with the text marks: editor.css drops the size select from the phone row. */}
          <div className="tb-more-sizes" role="group" aria-label="字号">{FONT_SIZES.map(sizeRow)}</div>
        </>)}
        <div className="tb-more-group" role="group" aria-label="颜色" key="颜色">
          <div className="tb-more-section">颜色</div>
          {swatches('文字颜色', COLORS, (hex) => activeTextColor === hex, (hex) => { editor?.chain().focus().setColor(hex).run() }, closeMore)}
          {menuRow('colorDefault', closeMore)}
          {swatches('高亮', HIGHLIGHTS, (hex) => highlightColor === hex, (hex) => { editor?.chain().focus().toggleHighlight({ color: hex }).run() }, closeMore)}
          {menuRow('highlightClear', closeMore)}
        </div>
        {moreSection('对齐', (['alignLeft', 'alignCenter', 'alignRight', 'alignJustify'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {moreSection('列表与块', (['bullet', 'ordered', 'task', 'quote', 'codeBlock'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {moreSection('缩进', (['outdent', 'indent'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {moreSection('插入', (['image', 'link', 'table', 'divider', 'hardBreak'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {moreSection('导航', (['find', 'outline'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
        {/*
         * Only 重做. 撤销 is still on the phone row, and a second button for a
         * control already under the thumb is noise; 重做 is gone from the row from
         * 760px down, so this is its only phone entry.
         */}
        {moreSection('历史', (['redo'] as CommandId[]).map((id) => menuRow(id, closeMore)))}
      </Popover>
    </div>
  </div>
}
