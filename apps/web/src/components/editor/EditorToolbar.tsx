import { useState } from 'react'
import {
  MessageCircle,
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, ChevronDown, Code2, Download,
  Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered,
  Minus, MoreHorizontal, Palette, Quote, Redo2, Strikethrough, Table2, Type, Underline, Undo2,
} from 'lucide-react'
import type { Editor } from '@tiptap/react'
import Popover from '../ui/Popover'

export type ToolbarActions = {
  onLink: () => void
  onImage: () => void
  onFind: () => void
  onOutline: () => void
  onExport: () => void
  onComment: () => void
}

const BLOCK_OPTIONS: Array<{ id: string; label: string; hint: string; run: (editor: Editor) => void }> = [
  { id: 'paragraph', label: '正文', hint: '普通段落', run: (editor) => editor.chain().focus().setParagraph().run() },
  { id: 'h1', label: '标题 1', hint: '大标题', run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: '标题 2', hint: '章节标题', run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: '标题 3', hint: '小节标题', run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
]

const FONT_SIZES = [
  { value: '12px', label: '12' }, { value: '14px', label: '14' }, { value: '16px', label: '16' },
  { value: '18px', label: '18' }, { value: '22px', label: '22' }, { value: '28px', label: '28' },
]

const COLORS = ['#1f2937', '#5f6673', '#b0453a', '#c0533f', '#b07a2b', '#3d7a54', '#2f6fb3', '#7a4fb3', '#b3447a']
const HIGHLIGHTS = ['#fff3c4', '#ffe1d6', '#e2f3e7', '#e2ecfb', '#f3e6fb', '#f7f1e1']

function currentBlockLabel(editor: Editor) {
  if (editor.isActive('heading', { level: 1 })) return '标题 1'
  if (editor.isActive('heading', { level: 2 })) return '标题 2'
  if (editor.isActive('heading', { level: 3 })) return '标题 3'
  return '正文'
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
  const disabled = !editor

  const item = (label: string, active: boolean, run: () => void, icon: React.ReactNode, extra?: string) => <button
    type="button"
    className={'tb-btn' + (active ? ' is-active' : '') + (extra ? ' ' + extra : '')}
    title={label}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onMouseDown={(event) => { event.preventDefault(); onInteract?.() }}
    onClick={run}
  >{icon}</button>

  return <div className="editor-toolbar" role="toolbar" aria-label="格式工具" onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const current = event.target as HTMLButtonElement; const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter((node) => !node.disabled); const position = buttons.indexOf(current); if (position >= 0) { event.preventDefault(); const next = buttons[(position + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; next?.focus() } } }}>
    <div className="tb-group tb-group-history">
      {item('撤销', false, () => editor?.chain().focus().undo().run(), <Undo2 size={16} />)}
      {item('重做', false, () => editor?.chain().focus().redo().run(), <Redo2 size={16} />)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-block">
      <div className="tb-anchor">
        <button type="button" className="tb-select" aria-haspopup="menu" aria-expanded={blockOpen} onMouseDown={(event) => { event.preventDefault(); onInteract?.() }}
          onClick={() => setBlockOpen((value) => !value)}>
          <span>{editor ? currentBlockLabel(editor) : '正文'}</span><ChevronDown size={13} />
        </button>
        <Popover open={blockOpen} onClose={() => setBlockOpen(false)} label="段落样式" align="left" className="tb-menu">
          {BLOCK_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitem" className={'tb-menu-item' + (editor?.isActive('heading', { level: Number(option.id.slice(1)) }) || (option.id === 'paragraph' && editor?.isActive('paragraph')) ? ' is-active' : '')}
            onClick={() => { option.run(editor!); setBlockOpen(false) }}>
            <span className={'tb-menu-preview ' + option.id}>{option.label}</span>
            <small>{option.hint}</small>
            {(option.id === 'paragraph' ? editor?.isActive('paragraph') : editor?.isActive('heading', { level: Number(option.id.slice(1)) })) && <Check size={14} />}
          </button>)}
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-select tb-size" aria-haspopup="menu" aria-expanded={sizeOpen} onClick={() => setSizeOpen((value) => !value)}>
          <span>{editor?.getAttributes('textStyle').fontSize?.replace('px', '') || '16'}</span><ChevronDown size={12} />
        </button>
        <Popover open={sizeOpen} onClose={() => setSizeOpen(false)} label="字号" align="left" className="tb-menu tb-size-menu">
          {FONT_SIZES.map((size) => <button key={size.value} type="button" role="menuitem" className="tb-menu-item" onClick={() => { editor?.chain().focus().setFontSize(size.value).run(); setSizeOpen(false) }}>
            <span style={{ fontSize: size.value }}>{size.label}</span>
          </button>)}
        </Popover>
      </div>
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-inline">
      {item('加粗', !!editor?.isActive('bold'), () => editor?.chain().focus().toggleBold().run(), <Bold size={16} />)}
      {item('斜体', !!editor?.isActive('italic'), () => editor?.chain().focus().toggleItalic().run(), <Italic size={16} />)}
      {item('下划线', !!editor?.isActive('underline'), () => editor?.chain().focus().toggleUnderline().run(), <Underline size={16} />)}
      {item('删除线', !!editor?.isActive('strike'), () => editor?.chain().focus().toggleStrike().run(), <Strikethrough size={16} />)}
      {item('行内代码', !!editor?.isActive('code'), () => editor?.chain().focus().toggleCode().run(), <Code2 size={16} />)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-color">
      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="文字颜色" aria-label="文字颜色" aria-haspopup="menu" aria-expanded={colorOpen} onClick={() => setColorOpen((value) => !value)}>
          <span className="tb-color"><Palette size={15} /><i style={{ background: (editor?.getAttributes('textStyle').color as string) || '#1f2937' }} /></span>
        </button>
        <Popover open={colorOpen} onClose={() => setColorOpen(false)} label="文字颜色" align="left" className="tb-menu tb-color-menu">
          <div className="tb-swatches">{COLORS.map((color) => <button key={color} type="button" aria-label={'颜色 ' + color} className="tb-swatch" style={{ background: color }} onClick={() => { editor?.chain().focus().setColor(color).run(); setColorOpen(false) }} />)}</div>
          <button type="button" className="tb-menu-item" onClick={() => { editor?.chain().focus().unsetColor().run(); setColorOpen(false) }}>默认颜色</button>
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="高亮" aria-label="高亮" aria-haspopup="menu" aria-expanded={highlightOpen} onClick={() => setHighlightOpen((value) => !value)}>
          <span className="tb-color tb-highlight"><Highlighter size={15} /><i /></span>
        </button>
        <Popover open={highlightOpen} onClose={() => setHighlightOpen(false)} label="高亮颜色" align="left" className="tb-menu tb-color-menu">
          <div className="tb-swatches">{HIGHLIGHTS.map((color) => <button key={color} type="button" aria-label={'高亮 ' + color} className="tb-swatch" style={{ background: color }} onClick={() => { editor?.chain().focus().toggleHighlight({ color }).run(); setHighlightOpen(false) }} />)}</div>
          <button type="button" className="tb-menu-item" onClick={() => { editor?.chain().focus().unsetHighlight().run(); setHighlightOpen(false) }}>清除高亮</button>
        </Popover>
      </div>

      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="对齐" aria-label="对齐方式" aria-haspopup="menu" aria-expanded={alignOpen} onClick={() => setAlignOpen((value) => !value)}>
          {editor?.isActive({ textAlign: 'center' }) ? <AlignCenter size={16} /> : editor?.isActive({ textAlign: 'right' }) ? <AlignRight size={16} /> : editor?.isActive({ textAlign: 'justify' }) ? <AlignJustify size={16} /> : <AlignLeft size={16} />}
        </button>
        <Popover open={alignOpen} onClose={() => setAlignOpen(false)} label="对齐方式" align="left" className="tb-menu tb-align-menu">
          {([
            ['left', '左对齐', <AlignLeft size={15} key="l" />],
            ['center', '居中', <AlignCenter size={15} key="c" />],
            ['right', '右对齐', <AlignRight size={15} key="r" />],
            ['justify', '两端对齐', <AlignJustify size={15} key="j" />],
          ] as const).map(([value, label, icon]) => <button key={value} type="button" role="menuitem" className={'tb-menu-item' + (editor?.isActive({ textAlign: value }) ? ' is-active' : '')} onClick={() => { editor?.chain().focus().setTextAlign(value).run(); setAlignOpen(false) }}>{icon}<span>{label}</span></button>)}
        </Popover>
      </div>
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-list">
      {item('项目符号列表', !!editor?.isActive('bulletList'), () => editor?.chain().focus().toggleBulletList().run(), <List size={16} />)}
      {item('编号列表', !!editor?.isActive('orderedList'), () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered size={16} />)}
      {item('任务列表', !!editor?.isActive('taskList'), () => editor?.chain().focus().toggleTaskList().run(), <span className="tb-task">☑</span>)}
      {item('引用', !!editor?.isActive('blockquote'), () => editor?.chain().focus().toggleBlockquote().run(), <Quote size={16} />)}
      {item('代码块', !!editor?.isActive('codeBlock'), () => editor?.chain().focus().toggleCodeBlock().run(), <span className="tb-mono">{'</>'}</span>)}
    </div>

    <span className="tb-separator" />

    <div className="tb-group tb-group-insert">
      {item('链接', !!editor?.isActive('link'), actions.onLink, <Link2 size={16} />)}
      {item('图片', false, actions.onImage, <ImagePlus size={16} />)}
      {item('表格', !!editor?.isActive('table'), () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), <Table2 size={16} />)}
      <div className="tb-anchor">
        <button type="button" className="tb-btn" title="更多插入" aria-label="更多插入" aria-haspopup="menu" aria-expanded={insertOpen} onClick={() => setInsertOpen((value) => !value)}><ChevronDown size={15} /></button>
        <Popover open={insertOpen} onClose={() => setInsertOpen(false)} label="插入" align="right" className="tb-menu">
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => { editor?.chain().focus().setHorizontalRule().run(); setInsertOpen(false) }}><Minus size={15} /><span>分割线</span></button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => { editor?.chain().focus().setHardBreak().run(); setInsertOpen(false) }}><Type size={15} /><span>换行符</span></button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => { actions.onOutline(); setInsertOpen(false) }}><ListOrdered size={15} /><span>文档大纲</span></button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => { actions.onFind(); setInsertOpen(false) }}><Download size={15} /><span>查找替换</span></button>
        </Popover>
      </div>
    </div>

    <div className="tb-spacer" />
    <div className="tb-group tb-group-extra">
      {item('评论', false, actions.onComment, <MessageCircle size={16} />)}
      {item('减少缩进', false, () => editor?.chain().focus().liftListItem('listItem').run(), <IndentDecrease size={16} />)}
      {item('增加缩进', false, () => editor?.chain().focus().sinkListItem('listItem').run(), <IndentIncrease size={16} />)}
    </div>

    {/*
     * Mobile only. On a phone the row cannot hold every group, and horizontal
     * scrolling hid 306px of it behind a fade — the controls existed but were
     * unreachable. This puts the same commands in a menu instead, so nothing is
     * lost and nothing has to be discovered by swiping a toolbar.
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
        onClick={() => setMoreOpen((value) => !value)}
      ><MoreHorizontal size={18} /></button>
      <Popover open={moreOpen} onClose={() => setMoreOpen(false)} label="更多格式" align="right" className="tb-menu tb-more-menu">
        <div className="tb-more-section">段落</div>
        {([
          ['正文', () => editor?.chain().focus().setParagraph().run()],
          ['标题 1', () => editor?.chain().focus().toggleHeading({ level: 1 }).run()],
          ['标题 2', () => editor?.chain().focus().toggleHeading({ level: 2 }).run()],
          ['标题 3', () => editor?.chain().focus().toggleHeading({ level: 3 }).run()],
        ] as const).map(([label, run]) => (
          <button key={label} type="button" role="menuitem" className="tb-menu-item" onClick={() => { run(); setMoreOpen(false) }}>
            <span>{label}</span>
          </button>
        ))}
        <div className="tb-more-section">列表与块</div>
        {([
          ['项目符号列表', List, () => editor?.chain().focus().toggleBulletList().run()],
          ['编号列表', ListOrdered, () => editor?.chain().focus().toggleOrderedList().run()],
          ['引用', Quote, () => editor?.chain().focus().toggleBlockquote().run()],
          ['代码块', Code2, () => editor?.chain().focus().toggleCodeBlock().run()],
        ] as const).map(([label, Icon, run]) => (
          <button key={label} type="button" role="menuitem" className="tb-menu-item" onClick={() => { run(); setMoreOpen(false) }}>
            <Icon size={15} /><span>{label}</span>
          </button>
        ))}
        <div className="tb-more-section">插入</div>
        {([
          ['表格', Table2, () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
          ['分割线', Minus, () => editor?.chain().focus().setHorizontalRule().run()],
          ['查找替换', Download, () => actions.onFind()],
          ['文档大纲', ListOrdered, () => actions.onOutline()],
        ] as const).map(([label, Icon, run]) => (
          <button key={label} type="button" role="menuitem" className="tb-menu-item" onClick={() => { run(); setMoreOpen(false) }}>
            <Icon size={15} /><span>{label}</span>
          </button>
        ))}
      </Popover>
    </div>
  </div>
}
