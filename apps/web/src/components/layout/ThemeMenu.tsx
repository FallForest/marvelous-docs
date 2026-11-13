import { Check } from 'lucide-react'
import Popover from '../ui/Popover'
import { THEMES } from '../../lib/theme'
import type { Theme } from '../../lib/theme'

type ThemeMenuProps = {
  open: boolean
  currentId: string
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * Theme picker.
 *
 * A radio group, not a list of commands: exactly one theme is active, and the
 * check mark is the state. Each row carries a small swatch strip built from the
 * theme's own tokens — that is what makes the list legible without previewing
 * every entry — and the hint says what the palette is *for* rather than which
 * hex it starts with.
 *
 * Adding a theme needs nothing here: THEMES is the list.
 */
export default function ThemeMenu({ open, currentId, onPick, onClose }: ThemeMenuProps) {
  return <Popover open={open} onClose={onClose} label="外观主题" className="theme-menu">
    <div className="menu-heading">外观</div>
    <div role="radiogroup" aria-label="选择主题" className="theme-list">
      {THEMES.map((theme) => <button
        key={theme.id}
        type="button"
        role="menuitemradio"
        aria-checked={theme.id === currentId}
        className={'menu-item theme-item' + (theme.id === currentId ? ' is-active' : '')}
        onClick={() => { onPick(theme.id); onClose() }}
      >
        <ThemeSwatch theme={theme} />
        <span className="menu-item-copy">
          <b>{theme.name}</b>
          <small>{theme.hint}</small>
        </span>
        {theme.id === currentId && <Check size={15} className="theme-check" />}
      </button>)}
    </div>
    <p className="theme-foot">主题只改变配色，版式和动效保持不变。</p>
  </Popover>
}

/**
 * A three-stop preview of the palette: page, chrome, accent.
 *
 * The colours come from the theme entry rather than from the live custom
 * properties, because this has to preview a theme that is not applied — a
 * var(--surface) here would resolve to the theme the page is already wearing and
 * every row would look identical.
 */
function ThemeSwatch({ theme }: { theme: Theme }) {
  const [page, chrome, accent] = theme.swatch
  return <span className="theme-swatch" aria-hidden="true">
    <i className="theme-dot" style={{ background: page, borderColor: chrome }} />
    <i className="theme-dot" style={{ background: chrome, borderColor: chrome }} />
    <i className="theme-dot" style={{ background: accent, borderColor: accent }} />
  </span>
}