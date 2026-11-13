import { useState } from 'react'
import type { ReactNode } from 'react'

type ArtIconName = 'brand-spark' | 'notebook' | 'idea-bulb' | 'folder' | 'document' | 'home' | 'favorite-star' | 'trash' | 'comment'
  | 'search' | 'help' | 'logout' | 'palette' | 'download' | 'history' | 'share' | 'shield' | 'selection' | 'new-document'

type ArtIconProps = {
  name: ArtIconName
  fallback: ReactNode
  className?: string
}

/**
 * A decorative material layer over the existing icon. CSS chooses the variant
 * from the root theme attribute, so changing appearance never remounts an editor
 * or alters a control's accessible name. A failed image keeps the original icon.
 */
export default function ArtIcon({ name, fallback, className = '' }: ArtIconProps) {
  const [failedName, setFailedName] = useState<string | null>(null)
  return <span className={'art-icon' + (className ? ' ' + className : '')} data-art-failed={failedName === name ? '' : undefined} aria-hidden="true">
    <img
      className="art-icon-image"
      src={'/art/handdrawn-v1/icons/' + name + '.webp'}
      width={64}
      height={64}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setFailedName(name)}
    />
    <span className="art-icon-fallback">{fallback}</span>
  </span>
}
