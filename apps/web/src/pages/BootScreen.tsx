import { Sparkles } from 'lucide-react'
import ArtIcon from '../components/ui/ArtIcon'

/**
 * Shown while a stored token is being exchanged for a session.
 *
 * The shell used to render the login form in this window, so every reload
 * flashed a password prompt at a user who was already signed in. A boot screen
 * is the honest state: something is being fetched, and it is not the user's
 * turn to type.
 *
 * It deliberately matches the login card's geometry: the swap is then a change
 * of message rather than a change of layout.
 */
export default function BootScreen() {
  return <div className="login-screen" data-vt-scope="main">
    <div className="login-card motion-rise">
      <div className="login-brand"><div className="brand-mark"><ArtIcon name="brand-spark" fallback={<Sparkles size={17} />} /></div><span>Marvelous Docs</span></div>
      <p className="login-boot"><span className="login-spinner" aria-hidden="true" />正在打开工作区…</p>
    </div>
  </div>
}
