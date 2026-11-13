import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/endpoints'
import { emptyContent } from '../lib/types'
import type { UpdateInfo } from '../lib/app-types'
import type {
  Comment, Doc, SearchHit, SearchScope, Template, User, Version,
  WorkspaceMember, WorkspaceStats,
} from '../lib/types'

type WorkspaceQuery = {
  commandOpen: boolean
  homeView: 'home' | 'search' | 'trash' | 'favorites'
  query: string
  searchScope: SearchScope
  workspaceView: 'documents' | 'admin'
}

type WorkspaceDataOptions = {
  token: string
  query: WorkspaceQuery
  /** Called when the session turns out to be invalid. */
  onSessionExpired: () => void
  notify: (message: string) => void
  leaveAdmin: () => void
}

/**
 * Data layer for the workspace shell.
 *
 * Owns everything that comes from the API — the document list, selection,
 * favourites, templates, stats, trash, search hits, and admin members — plus
 * the effects that keep them fresh. The shell keeps only presentation state
 * (which panel is open, what the user is typing), so a new screen can read
 * this data without re-implementing a loader.
 */
export function useWorkspaceData(options: WorkspaceDataOptions) {
  const { token, query } = options

  // Callbacks arrive as inline arrow functions, so they change identity on
  // every render. Holding them in refs keeps the effects below keyed on real
  // data (token, ids) instead of re-running — and re-selecting the first
  // document — on every keystroke elsewhere in the shell.
  const callbacks = useRef(options)
  callbacks.current = options
  const onSessionExpired = useCallback(() => callbacks.current.onSessionExpired(), [])
  const notify = useCallback((message: string) => callbacks.current.notify(message), [])
  const leaveAdmin = useCallback(() => callbacks.current.leaveAdmin(), [])

  const [user, setUser] = useState<User | null>(null)
  const [documents, setDocuments] = useState<Doc[]>([])
  const [active, setActive] = useState<Doc | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('mdocs-favorites') || '[]'))
  const [templates, setTemplates] = useState<Template[]>([])
  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [trashDocuments, setTrashDocuments] = useState<Doc[]>([])
  /** Days the server keeps a trashed row; null until the bin has been opened. */
  const [trashRetentionDays, setTrashRetentionDays] = useState<number | null>(null)
  const [searchResults, setSearchResults] = useState<SearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [adminMembers, setAdminMembers] = useState<WorkspaceMember[]>([])
  const [adminMembersBusy, setAdminMembersBusy] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  // A ref mirror lets callbacks read the latest document without re-subscribing.
  const activeRef = useRef<Doc | null>(null)
  activeRef.current = active

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const setFavorites = useCallback((next: string[]) => {
    setFavoriteIds(next)
    localStorage.setItem('mdocs-favorites', JSON.stringify(next))
  }, [])

  const refreshStats = useCallback(async () => {
    if (!token) return
    try {
      const result = await api.stats(token)
      setStats(result.stats)
    } catch {
      setStats(null)
    }
  }, [token])

  const refreshDocuments = useCallback(async () => {
    if (!token) return
    try {
      const result = await api.documents(token)
      setDocuments(result.documents || [])
    } catch {
      /* keep the current list rather than blanking the tree on a blip */
    }
  }, [token])

  // Session bootstrap: identity, tree, and favourites in one round trip set.
  useEffect(() => {
    if (!token) return
    let live = true
    Promise.all([api.me(token), api.documents(token), api.favorites(token)])
      .then(([me, docs, favorites]) => {
        if (!live) return
        if (!me.user) { onSessionExpired(); return }
        setUser(me.user)
        setDocuments(docs.documents || [])
        const favoriteRows = favorites.documents || []
        setFavoriteIds(favoriteRows.map((doc) => doc.id))
        localStorage.setItem('mdocs-favorites', JSON.stringify(favoriteRows.map((doc) => doc.id)))
        const firstDocument = docs.documents?.find((entry) => entry.kind !== 'folder')
        if (!activeRef.current && firstDocument) setActive(firstDocument)
      })
      .catch(() => { if (live) onSessionExpired() })
    return () => { live = false }
  }, [token, onSessionExpired])

  useEffect(() => {
    if (!token) { setTemplates([]); return }
    let live = true
    api.templates(token)
      .then((result) => { if (live) setTemplates(result.templates || []) })
      .catch(() => { if (live) setTemplates([]) })
    return () => { live = false }
  }, [token])

  useEffect(() => {
    if (!token) { setStats(null); return }
    void refreshStats()
  }, [token, refreshStats])

  useEffect(() => {
    if (!token || query.workspaceView !== 'admin' || user?.role !== 'admin') return
    let live = true
    setAdminMembersBusy(true)
    api.members(token)
      .then(({ members }) => { if (live) setAdminMembers(members || []) })
      .catch((error) => { if (live) { leaveAdmin(); notify('管理权限验证失败：' + error.message) } })
      .finally(() => { if (live) setAdminMembersBusy(false) })
    return () => { live = false }
  }, [token, user?.role, query.workspaceView, leaveAdmin, notify])

  useEffect(() => {
    if (!token || query.homeView !== 'trash') return
    let live = true
    api.trash(token)
      .then(({ documents: rows, retentionDays }) => {
        if (!live) return
        setTrashDocuments(rows || [])
        if (typeof retentionDays === 'number') setTrashRetentionDays(retentionDays)
      })
      .catch((error) => { if (live) notify('回收站加载失败：' + error.message) })
    return () => { live = false }
  }, [token, query.homeView, notify])

  // Debounced search: the palette and the search page share one request path.
  useEffect(() => {
    const trimmed = query.query === '__favorites__' ? '' : query.query.trim()
    if (!token || (!query.commandOpen && query.homeView !== 'search') || trimmed.length < 1) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    let live = true
    setSearchLoading(true)
    const timer = window.setTimeout(() => {
      api.search(token, trimmed, query.searchScope)
        .then(({ results }) => {
          if (live) setSearchResults((results || []).map((hit) => ({ ...hit, content: emptyContent })))
        })
        .catch(() => { if (live) setSearchResults([]) })
        .finally(() => { if (live) setSearchLoading(false) })
    }, 180)
    return () => { live = false; window.clearTimeout(timer) }
  }, [token, query.commandOpen, query.homeView, query.query, query.searchScope])

  useEffect(() => {
    if (!token || user?.role !== 'admin') { setUpdateInfo(null); return }
    let live = true
    api.updateCheck(token)
      .then((result) => {
        if (live && result.updateAvailable && result.latestVersion) {
          setUpdateInfo({ version: result.latestVersion, url: result.manifest?.releaseUrl, status: 'available' })
        }
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [token, user?.role])

  return {
    user, setUser,
    documents, setDocuments,
    active, setActive, activeRef,
    comments, setComments,
    versions, setVersions,
    favoriteIds, setFavoriteIds, favoriteSet, setFavorites,
    templates,
    stats, refreshStats, refreshDocuments,
    trashDocuments, setTrashDocuments,
    trashRetentionDays, setTrashRetentionDays,
    searchResults, searchLoading,
    adminMembers, adminMembersBusy,
    updateInfo, setUpdateInfo,
  }
}
