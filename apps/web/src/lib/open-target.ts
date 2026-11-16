import type { HomeView } from './app-types'
import type { Doc } from './types'

/**
 * One rule for "what does pressing a row open?".
 *
 * Before this file every entry point answered that question itself, and three of
 * them answered it differently:
 *
 *   - `SearchPage.onOpen` and `HomeDashboard.onOpen` called `setActive(doc)` and
 *     *then* `setSelectedFolderId(doc.parentId)`. For a folder, `parentId` is the
 *     folder's own parent, so pressing a folder selected the folder *above* it —
 *     or, at the root, cleared the selection and landed on the dashboard. Under
 *     the right circumstances a folder row could even mount the editor, because
 *     `active` was set to a folder and the editor branch renders on `active`.
 *   - `FolderOverview.onOpen` set the folder id and cleared `active` for a folder,
 *     but forgot `homeView` for a document, so opening a document from a folder
 *     page kept the page underneath it.
 *   - The sidebar tree had its own copy of both halves.
 *
 * The resolver is pure and takes the whole row, so the answer depends on the row
 * and nothing else. `viewForTarget` then turns that answer into the shell state
 * it implies, which is what makes the contract testable without a DOM.
 */

/** A document that sits in the bin and cannot be opened for editing. */
export type OpenTarget =
  | { kind: 'folder'; folderId: string }
  | { kind: 'document'; doc: Doc; parentFolderId: string | null; trashed: boolean }

/**
 * True for a row the retention sweep will eventually purge.
 *
 * `expiresAt` is derived server-side and only present on trash listings, so it is
 * the honest signal for "this row is in the bin" — `kind` cannot tell them apart.
 */
export function isTrashedRow(doc: Doc): boolean {
  return doc.kind !== 'folder' && Boolean(doc.expiresAt)
}

/**
 * What pressing `doc` opens.
 *
 * A folder opens its own folder page: `folderId` is the row's own id, never its
 * `parentId`. A document opens the editor and records the folder it lives in, so
 * the sidebar can keep that branch highlighted and the breadcrumb can name the
 * path. A trashed document resolves to a document too — the shell is what refuses
 * to mount the editor, once, instead of every list deciding for itself.
 */
export function openTarget(doc: Doc): OpenTarget {
  if (doc.kind === 'folder') return { kind: 'folder', folderId: doc.id }
  return { kind: 'document', doc, parentFolderId: doc.parentId ?? null, trashed: isTrashedRow(doc) }
}

/** The shell state an opened target implies: editor for a document, page for a folder. */
export type OpenView = { active: Doc | null; selectedFolderId: string | null; homeView: HomeView }

/**
 * The view state for an opened target.
 *
 * `homeView: 'home'` in both branches is deliberate: the folder page and the
 * editor are both *inside* the workspace tree, so whatever dashboard-family screen
 * was behind them (search results, trash, favourites) is no longer the screen.
 */
export function viewForTarget(target: OpenTarget): OpenView {
  if (target.kind === 'folder') return { active: null, selectedFolderId: target.folderId, homeView: 'home' }
  return { active: target.doc, selectedFolderId: target.parentFolderId, homeView: 'home' }
}
