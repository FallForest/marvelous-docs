# Document product acceptance contracts

Reviewed on 2026-11-15 against the current React/Tiptap 2/Yjs implementation.
This is an acceptance checklist for Marvelous Docs, not a claim of full Notion
feature parity. A working icon is only the start: the command must target the
right content, represent its availability, survive saving and reload, and have
an observable failure path.

## Reference and scope

The product patterns come from primary documentation:

- [Notion writing and editing](https://www.notion.com/help/writing-and-editing-basics): block menus, slash insertion, formatting and selection.
- [Notion comments](https://www.notion.com/help/comments-mentions-and-reminders): page discussions, inline discussions, replies, resolved/open filters and reopening.
- [Notion deletion and restoration](https://www.notion.com/help/duplicate-delete-and-restore-content): distinguish deleting a block from deleting a page, and recoverable deletion from permanent deletion.
- [Tiptap collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration): Yjs document ownership and collaborative history. Library implementation details are checked against the installed 2.x source; current online examples may target 3.x.

The policy below for deleted quoted text is this project's explicit decision.
The Notion help pages do not define a sufficiently precise deletion/anchor
algorithm to attribute that policy to Notion.

## Deleted content and comments

1. Deleting quoted text does not delete the discussion or mark it resolved.
   The original quote remains a historical snapshot; replies and their authors
   remain visible.
2. A range that no longer exists is visibly unavailable. Selecting its card
   must never jump to whichever unrelated text now occupies the old offsets.
3. Moving the caret, adding text before a quote, or changing the text inside it
   must not change a discussion's identity. Navigation uses the editor's live
   thread location. New collaborative anchors retain Yjs relative positions
   across saving and reload.
4. Legacy absolute anchors are validated conservatively. Ambiguous or missing
   text is shown as unavailable rather than attached by a fuzzy match.
5. A reply belongs to its root thread. Resolving/reopening is a thread action;
   replies are not counted as independent discussions. Switching documents
   clears the composer target and selection.
6. Deleting a whole document into trash preserves its associated data until
   restoration or permanent purge. Permanent purge removes its discussions and
   versions through the existing database cascade, with confirmation in the UI.
7. Authors can edit or delete their own comments. Deleting a comment clears its
   body and records a deletion time; its placeholder and replies survive.
   Administrators can manage resolution, but cannot rewrite another author's
   words. Deleted comments cannot be edited back into existence.

## Component and workflow checklist

“Changed” identifies this pass. “Existing” identifies contracts backed by the
existing implementation/tests; it does not imply every scenario was manually
tested against a production server in this pass.

| Component / workflow | Required behavior | Implementation / evidence |
| --- | --- | --- |
| Editor toolbar and bubble | Preserve selection when formatting; expose active/disabled states; hide writing actions while locked; the same command works through pointer and keyboard. | Changed: `EditorToolbar`, `BubbleToolbar`, shared indentation commands; editor-tools browser verifier. |
| Block gutter and context menu | Resolve nested content to its owning block; duplicate/move/delete without losing content; disable boundary moves; one undo step per structural action. | Existing: `BlockHandle`, `lib/editor/blocks.ts`, block command tests and `verify-blocks.mjs`. |
| Slash menu | Search aliases in Chinese/English, navigate by keyboard, remove only the slash trigger, preserve code text and handle viewport bounds. | Existing: `SlashMenu`, slash-menu tests, editor keyboard handlers. |
| Lists and indentation | Indent/outdent paragraphs, headings, ordinary and task lists consistently; do not steal table cell Tab navigation. | Changed: `tab-in-prose.ts`, `EditorToolbar`, real command tests and editor-tools verifier. |
| Code blocks | Literal multiline editing, exact-text copy, language choice, visual wrapping, explicit exit, and shared structural actions. | Existing: `CodeBlockView`, `code-block.ts`, code/block tests and browser verifier; detailed contract in `EDITING.md`. |
| Tables | Row/column insertion and deletion, header row/column/cell toggles, merge/split only where applicable, and cell keyboard navigation. Unavailable actions are disabled. | Changed: `TableMenu`, shared Popover and editor-tools verifier. |
| Images | Validate upload type/size; retain size/alignment through serialization; selected-image actions respect editor locking. | Existing upload/schema/export tests; changed lock guard in image tools. Async placement and editable alt/caption controls remain gaps below. |
| Links | Prefill and edit the entire current mark, unlink while retaining text, safely open allowed URLs, and map the target through edits while the dialog is open. Deleted targets reject stale operations. | Changed: `LinkDialog`, `link-editing.ts`, mapped editor sessions, unit tests and editor-tools browser verifier. |
| Find and replace | Match actual document positions through lists/tables and split text marks; update after edits; insert replacement literally; replace-all is one undoable operation without silent truncation. | Changed: `find-replace.ts`, `FindReplace`, unit tests and editor-tools verifier. |
| Outline | Recompute after heading changes, scroll to the selected heading, and clear listeners on editor replacement. | Existing: `OutlinePanel` subscription in `FindReplace.tsx`. |
| Comment markers | View-only decorations, live positions and unavailable-state reporting; markers do not leak into saved bodies or exports. | Changed: `comment-marks.ts`, unit tests and comment browser verifier. |
| Comment panel / composer | Thread grouping, status/author filters, retained quotes, safe navigation, reply target/cancel, duplicate-send guard, author-only edits, confirmed deletion with placeholders, and visible API errors. | Changed: `DocumentPanel`, shell comments wiring, migration 008 and comment API tests. |
| Autosave and recovery | Save status must confirm this editor's content, not another user's version increment. Preserve a safety copy before debounce/network failure; an older acknowledgement cannot remove newer edits. | Changed: `local-drafts.ts`, `App`, `DocumentEditor`, local-draft tests and `verify-draft-recovery.mjs`. |
| Draft recovery | Offer a local copy only when there is something the cloud lacks: not blank, and neither its words nor its structure are already stored. The check re-runs when the version changes and never repeats a dismissed offer in one session. Restoring replaces the body through the editor, so the text appears immediately and the ordinary autosave saves it; the title, place and history stay. Saving beside the document or downloading JSON are explicit alternatives, and a failed recovery retains the copy. | Changed: `local-drafts.ts` (`isBlankDraft`, `sameDraftContent`), `DraftRecovery`, `DocumentEditor` (`restoreBody`, no capture before the room syncs), browser verifier. Browser storage remains best effort; this is not a complete offline workspace. |
| Dialogs | Keep keyboard focus inside, restore prior focus, handle Escape, validate before submit, block duplicate/overlapping asynchronous submits, and keep errors visible. | Changed: `Dialog` and `PromptDialog` share the same shell; draft/dialog browser verifier exercises Tab, Enter, pending Escape and failed-request retry. |
| Document creation / templates | Blank creation stays blank; template use is explicit; manual titles survive later body changes. | Existing: template-menu and document-title tests, template library. |
| Tree / recent / favorites | Navigate to the correct identity, preserve ancestor paths and document URL, and derive recent access from this user's visits. | Existing: tree/url tests and workspace routes. |
| Search | Query title/body with ACL filtering, handle CJK terms, ignore stale responses and distinguish failures from no matches. | Existing server search/access tests and stale-response guards; changed failure notice and removed fabricated empty bodies from search results. |
| History / restore | Preview a historical body, page through events, reject concurrent restore conflicts, and preserve a backup before explicit replacement. | Existing history route, save queue and preview tests. Only persisted content appears in server history. |
| Trash | Recoverable soft deletion; restored live children survive a parent's expiry; permanent delete/empty requires a count-aware confirmation. | Existing trash route/unit/browser tests. |
| Sharing dialog | Load ACLs without stale document responses; represent load failures with retry; offer expiry; show a new raw URL for manual copying; never present its stored hash as a usable link. | Changed: `ShareDialog`, `useSharing`, sharing API and browser tests. |
| Public document | Render its title and read-only body; clear old content on token change; ignore stale responses; explain expired/revoked links; never promise an anonymous comment endpoint that does not exist. | Changed: `SharedDocumentPage`, sharing tests. |
| Import / export | Preserve supported nodes/marks across Markdown/HTML/JSON; PDF/print preserve page layout; decorations remain absent from exports. | Existing Markdown/schema/export and PDF browser tests. Whole-workspace export and Word import remain gaps. |
| Collaboration / authorization | Preserve convergent Yjs state; reject revoked writers and trashed rooms; never treat presence or another client's write as a persistence acknowledgement. | Existing socket/ACL tests; changed exact-body save confirmation and offline draft verifier. |
| Themes / mobile | Shared semantic tokens, visible overflow controls, keyboard-accessible overlays, viewport-safe placement, no horizontal page overflow. | Existing theme/selectability verifiers; changed table popover and shared modal behavior. |

## Remaining capabilities

These are explicit remaining gaps, not features implemented by this pass:

| Priority | Capability | Acceptance needed before shipping |
| --- | --- | --- |
| Next | Image captions / alt text and async insertion | Editable accessible text, export round-trip, a mapped upload placeholder at the original drop position, cancellation if the document changes. |
| Next | Mentions and inbox | Stable user/page IDs, target visibility checks, unread/read state, reliable delivery and navigation to a surviving anchor. Replies prefixed with plain `@name` must not imply a notification. |
| Next | Workspace/folder export | ACL-scoped document tree, media bundling, safe paths, progress, cancel and error reporting, verified reimport/restore story. |
| Later | Page references / backlinks | Stable identity, permission-filtered references, rename propagation and consistent export behavior. |
| Later | Offline workspace / PWA | Durable Yjs storage, authenticated reconnect, conflict handling, quota UX and revoked-access policy. A local JSON safety copy covers only body recovery. |
| Later | Toggle/callout/file/media/math blocks | Editor, server schema, Markdown/HTML/PDF/JSON, history and collaboration support must land together for each node type. |
| Later | Databases, views, formulas, synced blocks | A separate persisted data model, query and permission semantics, stable block IDs and tested migration/export contracts. |
| Later | API tokens, webhooks, audit export, i18n, self-service signup | Explicit identity/security and lifecycle contracts, not decorative settings without backend behavior. |

The next changes should close these workflows end to end. Adding a menu item
before its persistence, permissions and exports exist does not close a gap.
