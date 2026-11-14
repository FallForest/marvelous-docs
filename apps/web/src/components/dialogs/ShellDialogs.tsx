import { Dialog, PromptDialog } from '../ui/Dialog'
import type { UpdateInfo } from '../../lib/app-types'
import type { Doc } from '../../lib/types'

type ShellDialogsProps = {
  renameDoc: Doc | null
  deleteDoc: Doc | null
  purgeDoc: Doc | null
  /** How many rows the empty-trash confirmation would remove; 0 closes it. */
  emptyTrashCount: number
  emptyTrashBusy: boolean
  updatePrompt: UpdateInfo | null
  helpOpen: boolean
  linkPrompt: { from: number; to: number } | null
  onRename: (doc: Doc, title: string) => void
  onCancelRename: () => void
  onConfirmDelete: (doc: Doc) => void
  onCancelDelete: () => void
  onConfirmPurge: (doc: Doc) => void
  onCancelPurge: () => void
  onConfirmEmptyTrash: () => void
  onCancelEmptyTrash: () => void
  onConfirmUpdate: () => void
  onCancelUpdate: () => void
  onCloseHelp: () => void
  onInsertLink: (range: { from: number; to: number }, href: string) => void
  onCancelLink: () => void
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['搜索与命令面板', ['Ctrl', 'K']],
  ['强制保存', ['Ctrl', 'S']],
  ['导出 Markdown', ['Ctrl', 'Shift', 'E']],
  ['关闭弹层 / 面板', ['Esc']],
  ['发送评论', ['Ctrl', 'Enter']],
]

/**
 * Confirm, prompt, and help dialogs owned by the workspace shell.
 *
 * They are grouped here so the shell's JSX stays a readable list of surfaces
 * rather than a wall of modal definitions.
 */
export default function ShellDialogs(props: ShellDialogsProps) {
  const { renameDoc, deleteDoc, purgeDoc, updatePrompt, helpOpen, linkPrompt } = props

  return <>
    {renameDoc && <PromptDialog
      title="重命名"
      description={renameDoc.kind === 'folder' ? '给文件夹换一个更清晰的名字。' : '保存名称后，后续正文修改不会自动改名。'}
      label="名称"
      initialValue={renameDoc.title}
      confirmLabel="保存"
      validate={(value) => value ? (value.length > 120 ? '名称不能超过 120 个字符' : null) : '名称不能为空'}
      onSubmit={async (value) => { props.onCancelRename(); if (value !== renameDoc.title || renameDoc.titleMode === 'auto') props.onRename(renameDoc, value) }}
      onClose={props.onCancelRename}
    />}

    {deleteDoc && <Dialog
      title="移到回收站？"
      description={'“' + (deleteDoc.title || '未命名文档') + '”会移到回收站，之后仍可恢复。'}
      confirmLabel="移到回收站"
      danger
      onConfirm={() => props.onConfirmDelete(deleteDoc)}
      onClose={props.onCancelDelete}
    />}

    {purgeDoc && <Dialog
      title="永久删除？"
      description={'“' + (purgeDoc.title || '未命名文档') + '”将无法恢复，相关评论与历史也会一并删除。'}
      confirmLabel="永久删除"
      danger
      onConfirm={() => props.onConfirmPurge(purgeDoc)}
      onClose={props.onCancelPurge}
    />}

    {/*
      Emptying the bin is the bulk version of the same destructive action, so it
      gets the same confirm-with-a-count treatment: the number is what makes the
      dialog informative instead of ceremonial.
    */}
    {props.emptyTrashCount > 0 && <Dialog
      title={'清空回收站？'}
      description={'回收站里的 ' + props.emptyTrashCount + ' 项会被永久删除，无法恢复；相关评论与历史也会一并删除。'}
      confirmLabel="清空回收站"
      danger
      busy={props.emptyTrashBusy}
      onConfirm={props.onConfirmEmptyTrash}
      onClose={props.onCancelEmptyTrash}
    />}

    {updatePrompt && <Dialog
      title={'更新到 ' + updatePrompt.version + '？'}
      description="系统会先备份数据库，然后拉取新镜像并短暂重启服务。更新期间建议暂停编辑。"
      confirmLabel="开始更新"
      onConfirm={props.onConfirmUpdate}
      onClose={props.onCancelUpdate}
    />}

    {helpOpen && <Dialog
      title="快捷键与帮助"
      description="少用鼠标，编辑更快。"
      confirmLabel="知道了"
      cancelLabel="关闭"
      onConfirm={props.onCloseHelp}
      onClose={props.onCloseHelp}
    >
      <dl className="shortcut-list">
        {SHORTCUTS.map(([label, keys]) => <div className="shortcut-row" key={label}>
          <dt>{label}</dt>
          <dd>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dd>
        </div>)}
      </dl>
      <p className="help-note">协作连接断开时，编辑会保留在本地，恢复后自动同步。遇到界面异常可刷新页面，历史版本里能找回未同步内容。</p>
    </Dialog>}

    {linkPrompt && <PromptDialog
      title="添加链接"
      description="输入链接地址，选中文本会变成可点击链接。"
      label="链接地址"
      initialValue="https://"
      confirmLabel="添加链接"
      validate={(value) => {
        try {
          const url = new URL(value)
          return url.protocol === 'http:' || url.protocol === 'https:' ? null : '只支持 http 或 https 链接'
        } catch { return '请输入完整的网址' }
      }}
      onSubmit={async (value) => { const range = linkPrompt; props.onCancelLink(); props.onInsertLink(range, value) }}
      onClose={props.onCancelLink}
    />}
  </>
}
