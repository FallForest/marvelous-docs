const configuredCollabUrl = (import.meta.env?.VITE_COLLAB_URL as string | undefined)?.trim() || ''

export function resolveCollabUrl(location: Pick<Location, 'protocol' | 'host'> | undefined, configuredUrl = configuredCollabUrl) {
  if (configuredUrl) return configuredUrl
  if (!location) return ''
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return protocol + '//' + location.host + '/collab'
}

export const COLLAB_URL = typeof window === 'undefined' ? '' : resolveCollabUrl(window.location)
