import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import type * as Y from 'yjs'

/**
 * Protocol constants and message framing for the y-websocket v2 transport.
 *
 * A frame is a varUint message type followed by either a sync payload or an
 * awareness update. Keeping the encoding here means the socket handler and the
 * room lifecycle never have to agree on magic numbers.
 */

export const SYNC_MESSAGE = 0
export const AWARENESS_MESSAGE = 1

/** "Here is a document update" — broadcast to every client in the room. */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, SYNC_MESSAGE)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

/** Sync step 1: "send me your state vector", used on join and on read-only peers. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, SYNC_MESSAGE)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

/** Sync step 2: the authoritative state, sent to a read-only peer. */
export function encodeSyncStep2(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, SYNC_MESSAGE)
  syncProtocol.writeSyncStep2(encoder, doc)
  return encoding.toUint8Array(encoder)
}

/** Encodes an awareness update for the given client ids. */
export function encodeAwareness(
  awareness: awarenessProtocol.Awareness,
  changed: number[],
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, AWARENESS_MESSAGE)
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
  return encoding.toUint8Array(encoder)
}
