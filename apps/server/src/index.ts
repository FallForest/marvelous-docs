import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import pg from 'pg';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { prosemirrorToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const scrypt = promisify(scryptCallback);
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']) {
  app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
}

type Claims = { sub: string; email: string; workspaceId: string };
type AuthRequest = FastifyRequest & { user: Claims };
type DocumentRow = { id: string; workspace_id: string; parent_id: string | null; title: string; kind: 'document' | 'folder'; content: unknown; version: number; acl_restricted: boolean; deleted_at: Date | null; created_by: string; updated_by: string; created_at: Date; updated_at: Date; access_role?: string };
type Room = { id: string; doc: Y.Doc; awareness: awarenessProtocol.Awareness; clients: Map<WebSocket, { userId: string; canWrite: boolean; clientIds: Set<number> }>; timer?: NodeJS.Timeout; disposeTimer?: NodeJS.Timeout; saveQueue: Promise<void>; suppressSave: boolean; dirty: boolean; changeSeq: number; lastActor?: string };

const contentSchema = z.object({ schemaVersion: z.literal(1), doc: z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough() }).passthrough();
const uuidSchema = z.string().uuid();
const emailSchema = z.string().email().max(320).transform(v => v.toLowerCase());
const idParams = z.object({ id: uuidSchema });
const versionParams = z.object({ id: uuidSchema, versionId: uuidSchema });
const tiptapExtensions = [StarterKit, Underline];
const schema = getSchema(tiptapExtensions);
const rooms = new Map<string, Room>();
const roomLoads = new Map<string, Promise<Room>>();
const wsServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
const wsHttpServer = createServer();
const roomField = 'default';
const syncMessage = 0;
const awarenessMessage = 1;
const appVersion = process.env.APP_VERSION || '0.1.0';

type UpdateManifest = { version: string; releaseUrl?: string; notesUrl?: string; apiImage?: string; webImage?: string; sha256?: string };
function compareVersions(left: string, right: string): number {
  const parseVersion = (value: string) => value.replace(/^v/i, '').split(/[+-]/, 1)[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parseVersion(left); const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}
async function readUpdateManifest(): Promise<UpdateManifest | null> {
  const url = process.env.UPDATE_MANIFEST_URL?.trim();
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const value = await response.json() as unknown;
    const parsed = z.object({ version: z.string().min(1), releaseUrl: z.string().url().optional(), notesUrl: z.string().url().optional(), apiImage: z.string().optional(), webImage: z.string().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [, salt, expectedHex] = encoded.split(':');
  if (!salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function safeUser(row: { id: string; email: string; name: string; role: 'admin' | 'member' }) {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
async function initialize() {
  const migration = await import('node:fs/promises').then(fs => fs.readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  await pool.query(migration);
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT id FROM users WHERE lower(email)=lower($1)', [adminEmail]);
    if (exists.rowCount) { await client.query('COMMIT'); return; }
    const workspace = await client.query("INSERT INTO workspaces(name) VALUES ('Marvelous Docs') RETURNING id");
    const user = await client.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id', [adminEmail.toLowerCase(), process.env.BOOTSTRAP_ADMIN_NAME || process.env.ADMIN_NAME || 'Administrator', await passwordHash(adminPassword)]);
    await client.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin')", [workspace.rows[0].id, user.rows[0].id]);
    await client.query('COMMIT');
    app.log.info('Initial administrator created');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'development-only-change-this-secret' });
app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try { await request.jwtVerify(); }
  catch { return fail(reply, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.'); }
});
const authenticate = { preHandler: (app as any).authenticate };

async function getDocumentAccess(user: Claims, documentId: string) {
  const result = await pool.query<DocumentRow & { role: string; member_role: string }>(
    `SELECT d.*, da.role, m.role AS member_role
       FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2
       LEFT JOIN document_acl da ON da.document_id=d.id AND da.user_id=$2
      WHERE d.id=$1 AND d.workspace_id=$3 AND d.deleted_at IS NULL`, [documentId, user.sub, user.workspaceId]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const role = row.member_role === 'admin' ? 'owner' : (row.role || (row.acl_restricted ? 'none' : 'editor'));
  return { row, role };
}
function documentJson(row: DocumentRow) {
  return { id: row.id, title: row.title, kind: row.kind, parentId: row.parent_id, content: row.content, version: row.version, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at ?? null };
}
function createYDoc(docJson: unknown): Y.Doc {
  const parsed = schema.nodeFromJSON(docJson);
  const ydoc = new Y.Doc();
  prosemirrorToYXmlFragment(parsed, ydoc.getXmlFragment(roomField));
  return ydoc;
}
function contentFromYDoc(ydoc: Y.Doc) {
  return { schemaVersion: 1, doc: yDocToProsemirrorJSON(ydoc, roomField) };
}
function yState(doc: Y.Doc) { return Buffer.from(Y.encodeStateAsUpdate(doc)); }
async function getRoom(documentId: string): Promise<Room> {
  const existing = rooms.get(documentId);
  if (existing) return existing;
  const pending = roomLoads.get(documentId);
  if (pending) return pending;
  const loading = loadRoom(documentId);
  roomLoads.set(documentId, loading);
  try { return await loading; } finally { roomLoads.delete(documentId); }
}
async function loadRoom(documentId: string): Promise<Room> {
  const result = await pool.query('SELECT id,kind,content,yjs_state FROM documents WHERE id=$1', [documentId]);
  if (!result.rowCount) throw new Error('Document disappeared while opening collaboration room.');
  if (result.rows[0].kind !== 'document') throw new Error('Folders do not support collaborative editing.');
  let doc: Y.Doc;
  if (result.rows[0].yjs_state) {
    doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(result.rows[0].yjs_state));
  } else {
    doc = createYDoc((result.rows[0].content as { doc: unknown }).doc);
    await pool.query('UPDATE documents SET yjs_state=$2 WHERE id=$1 AND yjs_state IS NULL', [documentId,yState(doc)]);
  }
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const room: Room = { id: documentId, doc, awareness, clients: new Map(), saveQueue: Promise.resolve(), suppressSave: false, dirty: false, changeSeq: 0 };
  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, syncMessage);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const client of room.clients.keys()) if (client.readyState === WebSocket.OPEN) client.send(message);
    if (!room.suppressSave) {
      const actor = origin instanceof WebSocket ? room.clients.get(origin)?.userId : undefined;
      room.dirty = true;
      room.changeSeq++;
      room.lastActor = actor || room.lastActor;
      scheduleRoomSave(room);
    }
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed];
    if (origin instanceof WebSocket) {
      const controlled = room.clients.get(origin)?.clientIds;
      if (controlled) {
        added.forEach(id => controlled.add(id));
        updated.forEach(id => controlled.add(id));
        removed.forEach(id => controlled.delete(id));
      }
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, awarenessMessage);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const message = encoding.toUint8Array(encoder);
    for (const client of room.clients.keys()) if (client.readyState === WebSocket.OPEN) client.send(message);
  });
  rooms.set(documentId, room);
  return room;
}
function scheduleRoomSave(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = undefined;
    room.saveQueue = room.saveQueue.then(() => persistRoom(room)).catch(error => app.log.error(error, 'Collaboration persistence queue failed'));
  }, 500);
}
async function persistRoom(room: Room) {
      if (!room.dirty) return;
      const changeSeq = room.changeSeq;
      const content = contentFromYDoc(room.doc);
      const state = yState(room.doc);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query('SELECT title,content,version,updated_by FROM documents WHERE id=$1 FOR UPDATE', [room.id]);
        if (!current.rowCount) { await client.query('ROLLBACK'); return; }
        const row = current.rows[0];
        await client.query('INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)', [room.id,row.version,row.title,row.content,row.updated_by]);
        await client.query('UPDATE documents SET content=$2,yjs_state=$3,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1', [room.id,content,state,room.lastActor || row.updated_by]);
        await client.query('COMMIT');
        if (room.changeSeq === changeSeq) room.dirty = false;
      } catch (error) { await client.query('ROLLBACK'); app.log.error(error, 'Failed to persist collaborative document'); }
      finally { client.release(); }
}
async function flushRoom(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined; }
  if (!room.dirty) return room.saveQueue;
  room.saveQueue = room.saveQueue.then(() => persistRoom(room));
  await room.saveQueue;
}
async function syncRoomFromContent(room: Room, docJson: unknown) {
  const replacement = schema.nodeFromJSON(docJson);
  room.suppressSave = true;
  try {
    room.doc.transact(() => {
      const fragment = room.doc.getXmlFragment(roomField);
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(replacement, fragment);
    }, 'rest-content-replacement');
  } finally { room.suppressSave = false; }
  await pool.query('UPDATE documents SET yjs_state=$2 WHERE id=$1', [room.id,yState(room.doc)]);
}
async function requireDoc(request: AuthRequest, reply: FastifyReply, idValue: unknown, minimum: 'viewer' | 'editor' | 'owner' = 'viewer') {
  const id = parse(uuidSchema, idValue);
  if (!id) { fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.'); return null; }
  const access = await getDocumentAccess(request.user, id);
  if (!access) { fail(reply, 404, 'NOT_FOUND', 'Document was not found.'); return null; }
  if (access.row.kind !== 'document') { fail(reply, 404, 'NOT_A_DOCUMENT', 'This operation requires a document.'); return null; }
  const level: Record<string, number> = { none: -1, viewer: 0, editor: 1, owner: 2 };
  if (level[access.role] < level[minimum]) { fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.'); return null; }
  return access;
}

app.get('/healthz', async (_request, reply) => {
  try { await pool.query('SELECT 1'); return { status: 'ok' }; }
  catch { return fail(reply, 503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.'); }
});

app.get('/api/v1/system/version', async () => ({ version: appVersion }));
app.get('/api/v1/system/update-check', authenticate, async () => {
  const latest = await readUpdateManifest();
  return { currentVersion: appVersion, latestVersion: latest?.version || null, updateAvailable: Boolean(latest && compareVersions(latest.version, appVersion) > 0), manifest: latest };
});

async function requireWorkspaceAdmin(auth: AuthRequest, reply: FastifyReply) {
  const result = await pool.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role=\'admin\'', [auth.user.workspaceId, auth.user.sub]);
  if (!result.rowCount) { fail(reply, 403, 'ADMIN_REQUIRED', 'Workspace administrator role is required.'); return false; }
  return true;
}

app.post('/api/v1/system/update', authenticate, async (request, reply) => {
  const auth = request as AuthRequest;
  if (!await requireWorkspaceAdmin(auth, reply)) return;
  const agentUrl = process.env.UPDATE_AGENT_URL?.trim();
  const agentToken = process.env.UPDATE_AGENT_TOKEN?.trim();
  if (!agentUrl || !agentToken) return fail(reply, 503, 'UPDATER_UNAVAILABLE', 'The update agent is not configured.');
  try {
    const response = await fetch(`${agentUrl}/update`, { method: 'POST', headers: { authorization: `Bearer ${agentToken}` }, signal: AbortSignal.timeout(5000) });
    const body = await response.json() as unknown;
    if (!response.ok) return fail(reply, response.status === 409 ? 409 : 502, 'UPDATE_START_FAILED', (body as { error?: string }).error || 'Unable to start the update.');
    return reply.code(202).send({ update: body });
  } catch { return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent could not be reached.'); }
});

app.get('/api/v1/system/update-status', authenticate, async (request, reply) => {
  const auth = request as AuthRequest;
  if (!await requireWorkspaceAdmin(auth, reply)) return;
  const agentUrl = process.env.UPDATE_AGENT_URL?.trim();
  const agentToken = process.env.UPDATE_AGENT_TOKEN?.trim();
  if (!agentUrl || !agentToken) return fail(reply, 503, 'UPDATER_UNAVAILABLE', 'The update agent is not configured.');
  try {
    const response = await fetch(`${agentUrl}/status`, { headers: { authorization: `Bearer ${agentToken}` }, signal: AbortSignal.timeout(3000) });
    const body = await response.json() as unknown;
    if (!response.ok) return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent returned an error.');
    return { update: body };
  } catch { return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent could not be reached.'); }
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const input = parse(z.object({ email: emailSchema, password: z.string().min(1).max(1024) }), request.body);
  if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Email and password are required.');
  const result = await pool.query('SELECT u.id,u.email,u.name,u.password_hash,m.workspace_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) ORDER BY m.created_at LIMIT 1', [input.email]);
  if (!result.rowCount || !(await passwordMatches(input.password, result.rows[0].password_hash))) return fail(reply, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const row = result.rows[0];
  const token = app.jwt.sign({ sub: row.id, email: row.email, workspaceId: row.workspace_id } satisfies Claims, { expiresIn: '12h' });
  return { token, user: safeUser(row) };
});

app.post('/api/v1/auth/accept-invite', async (request, reply) => {
  const input = parse(z.object({ inviteToken: z.string().min(24), password: z.string().min(12).max(1024), name: z.string().trim().min(1).max(120) }), request.body);
  if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Invite token, name, and a password of at least 12 characters are required.');
  const tokenHash = createHash('sha256').update(input.inviteToken).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM invites WHERE token_hash=$1 AND expires_at>now() FOR UPDATE', [tokenHash]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'INVITE_INVALID', 'Invite is invalid or expired.'); }
    const invite = found.rows[0];
    const existing = await client.query('SELECT id FROM users WHERE lower(email)=lower($1)', [invite.email]);
    if (existing.rowCount) { await client.query('ROLLBACK'); return fail(reply, 409, 'ACCOUNT_EXISTS', 'This email already has an account. Ask an administrator to add it to the workspace.'); }
    const userResult = await client.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id,email,name', [invite.email, input.name, await passwordHash(input.password)]);
    const user = userResult.rows[0];
    await client.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role', [invite.workspace_id,user.id,invite.role]);
    await client.query('DELETE FROM invites WHERE id=$1', [invite.id]);
    await client.query('COMMIT');
    const token = app.jwt.sign({ sub: user.id, email: user.email, workspaceId: invite.workspace_id } satisfies Claims, { expiresIn: '12h' });
    return { token, user: safeUser({ ...user, role: invite.role }) };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.get('/api/v1/me', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query('SELECT u.id,u.email,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.workspace_id=$2 WHERE u.id=$1', [auth.user.sub, auth.user.workspaceId]);
  return { user: result.rowCount ? safeUser(result.rows[0]) : null };
});

app.post('/api/v1/invites', authenticate, async (request, reply) => {
  const auth = request as AuthRequest;
  const membership = await pool.query("SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", [auth.user.workspaceId,auth.user.sub]);
  if (!membership.rowCount || membership.rows[0].role !== 'admin') return fail(reply, 403, 'FORBIDDEN', 'Workspace administrator role is required.');
  const input = parse(z.object({ email: emailSchema, role: z.enum(['admin','member']).default('member') }), request.body);
  if (!input) return fail(reply, 400, 'INVALID_INPUT', 'A valid email and optional role are required.');
  const inviteToken = randomBytes(32).toString('base64url');
  const result = await pool.query('INSERT INTO invites(workspace_id,email,role,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4,now()+interval \'7 days\',$5) RETURNING id,email,role,expires_at', [auth.user.workspaceId,input.email,input.role,createHash('sha256').update(inviteToken).digest('hex'),auth.user.sub]);
  return reply.code(201).send({ invite: { ...result.rows[0], token: inviteToken } });
});

app.get('/api/v1/documents', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query<DocumentRow>(`SELECT d.* FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
    LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
    WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
    ORDER BY d.updated_at DESC`, [auth.user.sub,auth.user.workspaceId]);
  return { documents: result.rows.map(documentJson) };
});

app.get('/api/v1/workspace/members', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query('SELECT u.id,u.email,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.name', [auth.user.workspaceId]);
  return { members: result.rows.map(row => ({ ...safeUser(row), role: row.role })) };
});

app.get('/api/v1/documents/trash', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query<DocumentRow>(`SELECT d.* FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
    LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1 WHERE d.workspace_id=$2 AND d.deleted_at IS NOT NULL
    AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false) ORDER BY d.deleted_at DESC`, [auth.user.sub, auth.user.workspaceId]);
  return { documents: result.rows.map(documentJson) };
});

app.get('/api/v1/documents/recent', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query<DocumentRow>(`SELECT d.*, max(da.created_at) AS activity_at FROM document_activity da JOIN documents d ON d.id=da.document_id
    JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1 LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
    WHERE da.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
    GROUP BY d.id ORDER BY activity_at DESC LIMIT 50`, [auth.user.sub, auth.user.workspaceId]);
  return { documents: result.rows.map(documentJson) };
});

app.get('/api/v1/documents/favorites', authenticate, async request => {
  const auth = request as AuthRequest;
  const result = await pool.query<DocumentRow>(`SELECT d.* FROM document_favorites f JOIN documents d ON d.id=f.document_id
    WHERE f.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL ORDER BY f.created_at DESC`, [auth.user.sub, auth.user.workspaceId]);
  return { documents: result.rows.map(documentJson) };
});

app.put('/api/v1/documents/:id/favorite', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params); if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  if (!await requireDoc(auth, reply, params.id)) return;
  const input = parse(z.object({ favorite: z.boolean() }), request.body); if (!input) return fail(reply,400,'INVALID_INPUT','favorite must be boolean.');
  if (input.favorite) await pool.query('INSERT INTO document_favorites(document_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [params.id,auth.user.sub]);
  else await pool.query('DELETE FROM document_favorites WHERE document_id=$1 AND user_id=$2', [params.id,auth.user.sub]);
  return { favorite: input.favorite };
});

app.get('/api/v1/documents/search', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const query = parse(z.object({ q: z.string().trim().min(1).max(200), scope: z.enum(['all','title','content']).default('all') }), request.query);
  if (!query) return fail(reply,400,'INVALID_INPUT','q is required.');
  const result = await pool.query(`SELECT d.id,d.title,d.kind,d.parent_id AS "parentId",d.updated_at AS "updatedAt",d.version,
    CASE WHEN d.title ILIKE $3 THEN 1 ELSE 0 END AS title_match,
    ts_headline('simple', regexp_replace(d.content::text,'[{}\"]','','g'), plainto_tsquery('simple',$3), 'MaxWords=30,MinWords=10') AS snippet
    FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1 LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
    WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      AND (($4='title' AND d.title ILIKE '%'||$3||'%') OR ($4='content' AND d.content::text ILIKE '%'||$3||'%') OR ($4='all' AND (d.title ILIKE '%'||$3||'%' OR d.content::text ILIKE '%'||$3||'%')))
    ORDER BY title_match DESC,d.updated_at DESC LIMIT 50`, [auth.user.sub,auth.user.workspaceId,query.q,query.scope]);
  return { results: result.rows };
});

app.post('/api/v1/documents', authenticate, async (request, reply) => {
  const auth = request as AuthRequest;
  const input = parse(z.object({ title: z.string().trim().min(1).max(500), kind: z.enum(['document','folder']).default('document'), parentId: uuidSchema.optional().nullable(), content: contentSchema.optional() }), request.body);
  if (!input || (input.kind === 'document' && !input.content)) return fail(reply, 400, 'INVALID_INPUT', 'Documents require title and schemaVersion 1 content; folders require a title.');
  if (input.kind === 'folder' && input.content) return fail(reply, 400, 'INVALID_INPUT', 'Folder content is managed by the server and must not be supplied.');
  const content = input.kind === 'folder' ? { schemaVersion: 1, doc: { type: 'doc', content: [] } } : input.content!;
  let initialDoc: Y.Doc | null = null;
  if (input.kind === 'document') {
    try { initialDoc = createYDoc(content.doc); }
    catch { return fail(reply, 400, 'INVALID_CONTENT', 'Document content does not match the supported Tiptap schema.'); }
  }
  if (input.parentId) {
    const parent = await pool.query('SELECT id,kind FROM documents WHERE id=$1 AND workspace_id=$2', [input.parentId,auth.user.workspaceId]);
    if (!parent.rowCount || parent.rows[0].kind !== 'folder') return fail(reply, 404, 'PARENT_NOT_FOUND', 'Parent folder was not found.');
  }
  const result = await pool.query<DocumentRow>('INSERT INTO documents(workspace_id,parent_id,title,kind,content,yjs_state,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *', [auth.user.workspaceId,input.parentId ?? null,input.title,input.kind,content,initialDoc ? yState(initialDoc) : null,auth.user.sub]);
  initialDoc?.destroy();
  await pool.query("INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,'owner')", [result.rows[0].id,auth.user.sub]);
  return reply.code(201).send({ document: documentJson(result.rows[0]) });
});

app.get('/api/v1/documents/:id', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params);
  if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  const access = await requireDoc(auth,reply,params.id); if (!access) return;
  const room = rooms.get(params.id); if (room) await flushRoom(room);
  const current = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2',[params.id,auth.user.workspaceId]);
  await pool.query("INSERT INTO document_activity(document_id,user_id,action) VALUES ($1,$2,'view')", [params.id, auth.user.sub]);
  return current.rowCount ? { document: documentJson(current.rows[0]) } : fail(reply,404,'NOT_FOUND','Document was not found.');
});

app.put('/api/v1/documents/:id', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams,request.params);
  if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  const roomBeforeUpdate = rooms.get(params.id); if (roomBeforeUpdate) await flushRoom(roomBeforeUpdate);
  const access = await requireDoc(auth,reply,params.id,'editor'); if (!access) return;
  const input = parse(z.object({ title: z.string().trim().min(1).max(500).optional(), parentId: uuidSchema.nullable().optional(), content: contentSchema.optional(), expectedVersion: z.number().int().positive() }),request.body);
  if (!input || (input.title === undefined && input.parentId === undefined && input.content === undefined)) return fail(reply,400,'INVALID_INPUT','At least one document field and expectedVersion are required.');
  let replacementState: Buffer | null = null;
  if (input.content) {
    try { const replacement = createYDoc(input.content.doc); replacementState = yState(replacement); replacement.destroy(); }
    catch { return fail(reply,400,'INVALID_CONTENT','Document content does not match the supported Tiptap schema.'); }
  }
  if (input.expectedVersion !== access.row.version) return fail(reply,409,'VERSION_CONFLICT',`Document is at version ${access.row.version}; reload and retry.`);
  if (input.parentId) {
    const parent = await pool.query('SELECT id,kind FROM documents WHERE id=$1 AND workspace_id=$2 AND id<>$3',[input.parentId,auth.user.workspaceId,params.id]);
    if (!parent.rowCount || parent.rows[0].kind !== 'folder') return fail(reply,400,'INVALID_PARENT','Parent must be a folder in this workspace.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[params.id,auth.user.workspaceId]);
    if (!current.rowCount) { await client.query('ROLLBACK'); return fail(reply,404,'NOT_FOUND','Document was not found.'); }
    const old = current.rows[0];
    if (old.version !== input.expectedVersion) { await client.query('ROLLBACK'); return fail(reply,409,'VERSION_CONFLICT',`Document is at version ${old.version}; reload and retry.`); }
    await client.query('INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)',[old.id,old.version,old.title,old.content,old.updated_by]);
    const updated = await client.query<DocumentRow>(`UPDATE documents SET title=COALESCE($2,title), parent_id=CASE WHEN $3 THEN $4 ELSE parent_id END,
      content=COALESCE($5,content), yjs_state=COALESCE($7,yjs_state), version=version+1, updated_by=$6, updated_at=now() WHERE id=$1 RETURNING *`,[params.id,input.title ?? null,input.parentId !== undefined,input.parentId ?? null,input.content ?? null,auth.user.sub,replacementState]);
    await client.query('COMMIT');
    const activeRoom = input.content ? rooms.get(params.id) : undefined;
    if (activeRoom) await syncRoomFromContent(activeRoom, input.content!.doc);
    return { document: documentJson(updated.rows[0]) };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.delete('/api/v1/documents/:id', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params); if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  if (!await requireDoc(auth, reply, params.id, 'owner')) return;
  await pool.query('UPDATE documents SET deleted_at=now(),updated_at=now(),updated_by=$2 WHERE id=$1', [params.id,auth.user.sub]);
  return { ok: true };
});
app.post('/api/v1/documents/:id/restore', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params); if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  const result = await pool.query('SELECT d.* FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2 WHERE d.id=$1 AND m.role IN (\'admin\',\'member\')', [params.id,auth.user.sub]);
  if (!result.rowCount) return fail(reply,404,'NOT_FOUND','Document was not found.');
  await pool.query('UPDATE documents SET deleted_at=NULL,updated_at=now(),updated_by=$2 WHERE id=$1', [params.id,auth.user.sub]); return { ok: true };
});
app.delete('/api/v1/documents/:id/permanent', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params); if (!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  const owner = await pool.query('SELECT 1 FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2 WHERE d.id=$1 AND (m.role=\'admin\' OR d.created_by=$2)', [params.id,auth.user.sub]);
  if (!owner.rowCount) return fail(reply,404,'NOT_FOUND','Document was not found.');
  await pool.query('DELETE FROM documents WHERE id=$1 AND deleted_at IS NOT NULL', [params.id]); return { ok: true };
});

app.get('/api/v1/documents/:id/acl', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params);
  if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.');
  if (!await requireDoc(auth, reply, params.id, 'owner')) return;
  const result = await pool.query('SELECT u.id AS "userId",u.email,u.name,a.role FROM document_acl a JOIN users u ON u.id=a.user_id WHERE a.document_id=$1 ORDER BY u.name', [params.id]);
  const settings = await pool.query('SELECT acl_restricted FROM documents WHERE id=$1', [params.id]);
  return { restricted: Boolean(settings.rows[0]?.acl_restricted), permissions: result.rows };
});
app.put('/api/v1/documents/:id/acl', authenticate, async (request, reply) => {
  const auth = request as AuthRequest; const params = parse(idParams, request.params);
  if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.');
  if (!await requireDoc(auth, reply, params.id, 'owner')) return;
  const input = parse(z.object({ userId: uuidSchema, role: z.enum(['owner','editor','viewer']).nullable(), restricted: z.boolean().optional() }), request.body);
  if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide a workspace userId and role, or null to remove the explicit permission.');
  const member = await pool.query('SELECT 1 FROM memberships m JOIN documents d ON d.workspace_id=m.workspace_id WHERE d.id=$1 AND m.user_id=$2', [params.id, input.userId]);
  if (!member.rowCount) return fail(reply, 404, 'MEMBER_NOT_FOUND', 'User is not a member of this workspace.');
  if (input.userId === auth.user.sub && input.role !== 'owner') return fail(reply, 400, 'OWNER_REQUIRED', 'Document owners cannot remove their own owner role.');
  if (input.restricted !== undefined) await pool.query('UPDATE documents SET acl_restricted=$2 WHERE id=$1', [params.id, input.restricted]);
  else await pool.query('UPDATE documents SET acl_restricted=true WHERE id=$1', [params.id]);
  if (input.role === null) await pool.query('DELETE FROM document_acl WHERE document_id=$1 AND user_id=$2', [params.id,input.userId]);
  else await pool.query('INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(document_id,user_id) DO UPDATE SET role=EXCLUDED.role', [params.id,input.userId,input.role]);
  return { ok: true };
});

app.get('/api/v1/documents/:id/comments', authenticate, async (request, reply) => {
  const auth=request as AuthRequest; const params=parse(idParams,request.params); if(!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  if(!await requireDoc(auth,reply,params.id)) return;
  const result=await pool.query('SELECT c.id,c.parent_id AS "parentId",c.body,c.anchor,c.status,c.resolved_at AS "resolvedAt",c.resolved_by AS "resolvedBy",c.created_at AS "createdAt",c.updated_at AS "updatedAt",u.id AS "userId",u.name AS "userName" FROM comments c JOIN users u ON u.id=c.user_id WHERE c.document_id=$1 ORDER BY c.created_at',[params.id]);
  return { comments: result.rows };
});
app.post('/api/v1/documents/:id/comments', authenticate, async (request, reply) => {
  const auth=request as AuthRequest; const params=parse(idParams,request.params); if(!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  if(!await requireDoc(auth,reply,params.id,'editor')) return;
  const input=parse(z.object({body:z.string().trim().min(1).max(10000),anchor:z.unknown().optional(),parentId:uuidSchema.optional()}),request.body);
  if(!input) return fail(reply,400,'INVALID_INPUT','Comment body is required.');
  if (input.parentId) { const parent=await pool.query('SELECT 1 FROM comments WHERE id=$1 AND document_id=$2',[input.parentId,params.id]); if(!parent.rowCount) return fail(reply,404,'PARENT_COMMENT_NOT_FOUND','Parent comment was not found.'); }
  const result=await pool.query('INSERT INTO comments(document_id,user_id,body,anchor,parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,parent_id AS "parentId",body,anchor,status,created_at AS "createdAt",updated_at AS "updatedAt"',[params.id,auth.user.sub,input.body,input.anchor ?? null,input.parentId ?? null]);
  return reply.code(201).send({comment:{...result.rows[0],userId:auth.user.sub}});
});
app.patch('/api/v1/documents/:id/comments/:commentId', authenticate, async (request,reply)=>{
  const auth=request as AuthRequest; const params=parse(z.object({id:uuidSchema,commentId:uuidSchema}),request.params); if(!params) return fail(reply,400,'INVALID_ID','Document and comment ids must be UUIDs.');
  if(!await requireDoc(auth,reply,params.id,'editor')) return; const input=parse(z.object({body:z.string().trim().min(1).max(10000).optional(),status:z.enum(['open','resolved']).optional()}),request.body); if(!input || (!input.body && !input.status)) return fail(reply,400,'INVALID_INPUT','Comment body or status is required.');
  const result=await pool.query('UPDATE comments SET body=COALESCE($3,body),status=COALESCE($4,status),resolved_at=CASE WHEN $4=\'resolved\' THEN now() WHEN $4=\'open\' THEN NULL ELSE resolved_at END,resolved_by=CASE WHEN $4=\'resolved\' THEN $2 WHEN $4=\'open\' THEN NULL ELSE resolved_by END,updated_at=now() WHERE id=$1 AND document_id=$5 AND (user_id=$2 OR EXISTS (SELECT 1 FROM memberships m JOIN documents d ON d.workspace_id=m.workspace_id WHERE d.id=$5 AND m.user_id=$2 AND m.role=\'admin\')) RETURNING id,body,status,parent_id AS "parentId",resolved_at AS "resolvedAt",updated_at AS "updatedAt"',[params.commentId,auth.user.sub,input.body ?? null,input.status ?? null,params.id]);
  if(!result.rowCount) return fail(reply,404,'COMMENT_NOT_FOUND','Comment was not found.'); return {comment:result.rows[0]};
});

app.get('/api/v1/documents/:id/versions', authenticate, async (request,reply)=>{
  const auth=request as AuthRequest; const params=parse(idParams,request.params); if(!params) return fail(reply,400,'INVALID_ID','Document id must be a UUID.');
  if(!await requireDoc(auth,reply,params.id)) return;
  const room=rooms.get(params.id); if(room) await flushRoom(room);
  const result=await pool.query('SELECT id,version,title,content,created_by AS "createdBy",created_at AS "createdAt" FROM document_versions WHERE document_id=$1 ORDER BY version DESC',[params.id]);
  return {versions:result.rows};
});
app.get('/api/v1/documents/:id/versions/:versionId', authenticate, async (request,reply)=>{
  const auth=request as AuthRequest; const params=parse(versionParams,request.params); if(!params) return fail(reply,400,'INVALID_ID','Document and version ids must be UUIDs.');
  if(!await requireDoc(auth,reply,params.id)) return;
  const result=await pool.query('SELECT id,document_id AS "documentId",version,title,content,created_by AS "createdBy",u.name AS "createdByName",created_at AS "createdAt" FROM document_versions v JOIN users u ON u.id=v.created_by WHERE v.id=$1 AND v.document_id=$2',[params.versionId,params.id]);
  if(!result.rowCount) return fail(reply,404,'VERSION_NOT_FOUND','Version was not found.'); return { version: result.rows[0] };
});
app.post('/api/v1/documents/:id/versions/:versionId/restore', authenticate, async (request,reply)=>{
  const auth=request as AuthRequest; const params=parse(versionParams,request.params); if(!params) return fail(reply,400,'INVALID_ID','Document and version ids must be UUIDs.');
  const room=rooms.get(params.id); if(room) await flushRoom(room);
  const access=await requireDoc(auth,reply,params.id,'editor'); if(!access) return;
  const input=parse(z.object({expectedVersion:z.number().int().positive()}),request.body);
  if(!input) return fail(reply,400,'INVALID_INPUT','expectedVersion is required.');
  if(input.expectedVersion!==access.row.version) return fail(reply,409,'VERSION_CONFLICT',`Document is at version ${access.row.version}; reload and retry.`);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const current=await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 FOR UPDATE',[params.id]);
    if(!current.rowCount) { await client.query('ROLLBACK'); return fail(reply,404,'NOT_FOUND','Document was not found.'); }
    const old=current.rows[0];
    if(old.version!==input.expectedVersion) { await client.query('ROLLBACK'); return fail(reply,409,'VERSION_CONFLICT',`Document is at version ${old.version}; reload and retry.`); }
    const target=await client.query('SELECT title,content FROM document_versions WHERE id=$1 AND document_id=$2',[params.versionId,params.id]);
    if(!target.rowCount) { await client.query('ROLLBACK'); return fail(reply,404,'VERSION_NOT_FOUND','Version was not found.'); }
    let restoredState: Buffer;
    try { const restored = createYDoc((target.rows[0].content as { doc: unknown }).doc); restoredState = yState(restored); restored.destroy(); }
    catch { await client.query('ROLLBACK'); return fail(reply,409,'INVALID_STORED_CONTENT','The selected version cannot be restored with the current editor schema.'); }
    await client.query('INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)',[old.id,old.version,old.title,old.content,old.updated_by]);
    const updated=await client.query<DocumentRow>('UPDATE documents SET title=$2,content=$3,yjs_state=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *',[params.id,target.rows[0].title,target.rows[0].content,restoredState,auth.user.sub]);
    await client.query('COMMIT');
    const activeRoom = rooms.get(params.id); if (activeRoom) await syncRoomFromContent(activeRoom, (target.rows[0].content as { doc: unknown }).doc);
    return {document:documentJson(updated.rows[0])};
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.put('/api/v1/uploads', authenticate, async (request, reply) => {
  const auth = request as AuthRequest;
  const body = request.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) return fail(reply, 400, 'INVALID_INPUT', 'Upload body is required.');
  if (body.length > 20 * 1024 * 1024) return fail(reply, 413, 'FILE_TOO_LARGE', 'Files are limited to 20 MB.');
  const mime = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
  const allowed = new Set(['application/octet-stream','image/png','image/jpeg','image/gif','image/webp','application/pdf']);
  if (!allowed.has(mime)) return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'This file type is not supported.');
  const rawName = String(request.headers['x-file-name'] || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload.bin';
  const id = randomBytes(16).toString('hex'); const dir = process.env.UPLOAD_DIR || '/data/uploads'; await mkdir(dir, { recursive: true });
  const filename = `${id}-${rawName}`; await writeFile(join(dir, filename), body);
  return reply.code(201).send({ file: { id, name: rawName, mimeType: mime, size: body.length, url: `/api/v1/uploads/${filename}`, uploadedBy: auth.user.sub } });
});
app.get('/api/v1/uploads/:filename', async (request, reply) => {
  const filename = String((request.params as { filename?: string }).filename || ''); if (!/^[a-f0-9]{32}-[a-zA-Z0-9._-]+$/.test(filename)) return fail(reply,404,'NOT_FOUND','File was not found.');
  try { const fs = await import('node:fs/promises'); const data = await fs.readFile(join(process.env.UPLOAD_DIR || '/data/uploads', filename)); return reply.type('application/octet-stream').send(data); }
  catch { return fail(reply,404,'NOT_FOUND','File was not found.'); }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if ((error as { validation?: unknown }).validation) return fail(reply,400,'INVALID_INPUT','Request validation failed.');
  return fail(reply,500,'INTERNAL_ERROR','An unexpected server error occurred.');
});

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
function messageBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}
async function attachCollaborationSocket(ws: WebSocket, room: Room, user: Claims, canWrite: boolean) {
  const clientState = { userId: user.sub, canWrite, clientIds: new Set<number>() };
  room.clients.set(ws, clientState);
  if (room.disposeTimer) { clearTimeout(room.disposeTimer); room.disposeTimer = undefined; }
  ws.on('message', data => {
    try {
      const bytes = messageBytes(data as RawData);
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === syncMessage) {
        const typeDecoder = decoding.createDecoder(bytes);
        decoding.readVarUint(typeDecoder);
        const syncType = decoding.readVarUint(typeDecoder);
        if (!clientState.canWrite && syncType !== syncProtocol.messageYjsSyncStep1) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, syncMessage);
          syncProtocol.writeSyncStep2(encoder, room.doc);
          if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(encoder));
          return;
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, syncMessage);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        if (encoding.length(encoder) > 1 && ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(encoder));
      } else if (messageType === awarenessMessage) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (error) {
      app.log.warn(error, 'Invalid y-websocket protocol message');
      ws.close(1003, 'Invalid collaboration message');
    }
  });
  ws.on('close', () => {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...clientState.clientIds], ws);
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      void flushRoom(room);
      room.disposeTimer = setTimeout(() => {
        void flushRoom(room).finally(() => {
          if (room.clients.size === 0) {
            rooms.delete(room.id);
            room.awareness.destroy();
            room.doc.destroy();
          }
        });
      }, 5 * 60 * 1000);
    }
  });

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, syncMessage);
  syncProtocol.writeSyncStep1(syncEncoder, room.doc);
  ws.send(encoding.toUint8Array(syncEncoder));
  const states = room.awareness.getStates();
  if (states.size) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, awarenessMessage);
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }
}

wsHttpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
  void (async () => {
    const url = new URL(request.url || '/', 'http://localhost');
    const match = /^\/collab\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return rejectUpgrade(socket, 404, 'Not Found');
    const documentId = decodeURIComponent(match[1]);
    if (!uuidSchema.safeParse(documentId).success) return rejectUpgrade(socket, 400, 'Bad Request');
    const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = url.searchParams.get('token') || bearer;
    if (!token) return rejectUpgrade(socket, 401, 'Unauthorized');
    let user: Claims;
    try { user = app.jwt.verify<Claims>(token); }
    catch { return rejectUpgrade(socket, 401, 'Unauthorized'); }
    if (!user.sub || !user.workspaceId) return rejectUpgrade(socket, 401, 'Unauthorized');
    const access = await getDocumentAccess(user, documentId);
    if (!access || access.role === 'none') return rejectUpgrade(socket, access ? 403 : 404, access ? 'Forbidden' : 'Not Found');
    const room = await getRoom(documentId);
    wsServer.handleUpgrade(request, socket, head, ws => {
      void attachCollaborationSocket(ws, room, user, access.role !== 'viewer');
    });
  })().catch(error => {
    app.log.error(error, 'Collaboration websocket upgrade failed');
    if (!socket.destroyed) rejectUpgrade(socket, 500, 'Internal Server Error');
  });
});

const port = Number(process.env.PORT || 3000);
const collabPort = Number(process.env.COLLAB_PORT || 1234);
await initialize();
await app.listen({ port, host: process.env.HOST || '0.0.0.0' });
await new Promise<void>((resolve, reject) => {
  wsHttpServer.once('error', reject);
  wsHttpServer.listen(collabPort, '0.0.0.0', resolve);
});
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, async () => {
  for (const ws of wsServer.clients) ws.close(1001, 'Server shutting down');
  await Promise.all([...rooms.values()].map(flushRoom));
  wsServer.close(); wsHttpServer.close();
  await app.close(); await pool.end(); process.exit(0);
});
