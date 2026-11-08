import { createServer } from 'node:http';

export const IDS = {
  doc: '11111111-1111-4111-8111-111111111111',
  folder: '22222222-2222-4222-8222-222222222222',
  version: '33333333-3333-4333-8333-333333333333',
  comment: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
  otherUser: '66666666-6666-4666-8666-666666666666',
  created: '77777777-7777-4777-8777-777777777777',
  forbidden: '99999999-9999-4999-8999-999999999999',
  missing: '88888888-8888-4888-8888-888888888888'
};

export const TOKEN = 'test-token';

const user = { id: IDS.user, email: 'admin@example.com', name: 'Ada Lovelace', role: 'admin' };
const otherUser = { id: IDS.otherUser, email: 'grace@example.com', name: 'Grace Hopper', role: 'member' };

const blankContent = { schemaVersion: 1, doc: { type: 'doc', content: [] } };
const paragraphContent = {
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quarterly plan body' }] }] }
};

function baseDocument(overrides) {
  return {
    id: IDS.doc,
    title: 'Quarterly plan',
    kind: 'document',
    parentId: null,
    content: paragraphContent,
    version: 3,
    createdBy: IDS.user,
    updatedBy: IDS.user,
    createdAt: '2026-01-02T10:00:00.000Z',
    updatedAt: '2026-01-03T10:00:00.000Z',
    deletedAt: null,
    ...overrides
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function fail(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function versionConflict(res, current) {
  fail(res, 409, 'VERSION_CONFLICT', 'Document is at version ' + current + '; reload and retry.');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function startMockServer() {
  const state = {
    documents: new Map(),
    requests: []
  };
  state.documents.set(IDS.doc, baseDocument({}));
  state.documents.set(IDS.folder, baseDocument({ id: IDS.folder, title: 'Projects', kind: 'folder', content: blankContent }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const raw = await readBody(req);
    const text = raw.toString('utf8');
    let body;
    if (text !== '' && (req.headers['content-type'] ?? '').includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    state.requests.push({ method, path, query: Object.fromEntries(url.searchParams), body });

    if (path === '/healthz' && method === 'GET') return json(res, 200, { status: 'ok' });
    if (path === '/api/v1/system/version' && method === 'GET') return json(res, 200, { version: '0.1.0' });
    if (path === '/api/v1/system/update-check' && method === 'GET') {
      return json(res, 200, { currentVersion: '0.1.0', latestVersion: null, updateAvailable: false, manifest: null });
    }
    if (path === '/api/v1/auth/login' && method === 'POST') {
      const credentials = body ?? {};
      if (credentials.email === user.email && credentials.password === 'secret') {
        return json(res, 200, { token: TOKEN, user });
      }
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const authorization = req.headers.authorization ?? '';
    if (authorization !== 'Bearer ' + TOKEN) {
      return fail(res, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.');
    }

    if (path === '/api/v1/me' && method === 'GET') return json(res, 200, { user });
    if (path === '/api/v1/workspace/members' && method === 'GET') {
      return json(res, 200, { members: [user, otherUser] });
    }
    if (path === '/api/v1/workspace/stats' && method === 'GET') {
      return json(res, 200, {
        stats: { documents: 2, folders: 1, members: 2, openComments: 1, trashed: 0, versions: 4 }
      });
    }
    if (path === '/api/v1/invites' && method === 'POST') {
      return json(res, 201, {
        invite: {
          id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          email: body?.email ?? 'new@example.com',
          role: body?.role ?? 'member',
          expiresAt: '2026-02-01T00:00:00.000Z',
          token: 'invite-token-abcdefghijklmnop'
        }
      });
    }
    if (path === '/api/v1/templates' && method === 'GET') {
      return json(res, 200, {
        templates: [
          { id: 'blank', name: 'Blank', description: 'Empty document', content: blankContent },
          {
            id: 'meeting-notes',
            name: 'Meeting notes',
            description: 'Agenda, decisions, action items',
            content: {
              schemaVersion: 1,
              doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Meeting notes' }] }] }
            }
          }
        ]
      });
    }
    if (path === '/api/v1/documents' && method === 'GET') {
      return json(res, 200, { documents: [...state.documents.values()] });
    }
    if (path === '/api/v1/documents/trash' && method === 'GET') {
      return json(res, 200, { documents: [] });
    }
    if (path === '/api/v1/documents/recent' && method === 'GET') {
      return json(res, 200, { documents: [state.documents.get(IDS.doc)] });
    }
    if (path === '/api/v1/documents/favorites' && method === 'GET') {
      return json(res, 200, { documents: [state.documents.get(IDS.doc)] });
    }
    if (path === '/api/v1/documents/search' && method === 'GET') {
      return json(res, 200, {
        results: [
          {
            id: IDS.doc,
            title: 'Quarterly plan',
            kind: 'document',
            parentId: null,
            version: 3,
            updatedAt: '2026-01-03T10:00:00.000Z',
            titleMatch: 1,
            snippet: 'Quarterly\n   plan  body'
          }
        ]
      });
    }
    if (path === '/api/v1/documents/import' && method === 'POST') {
      const created = baseDocument({
        id: IDS.created,
        title: body?.title ?? 'Imported document',
        version: 1,
        content: paragraphContent,
        parentId: body?.parentId ?? null
      });
      state.documents.set(created.id, created);
      return json(res, 201, { document: created });
    }
    if (path === '/api/v1/documents' && method === 'POST') {
      const created = baseDocument({
        id: IDS.created,
        title: body?.title ?? 'Untitled',
        kind: body?.kind === 'folder' ? 'folder' : 'document',
        version: 1,
        content: body?.content ?? blankContent,
        parentId: body?.parentId ?? null
      });
      state.documents.set(created.id, created);
      return json(res, 201, { document: created });
    }
    if (path === '/api/v1/uploads' && method === 'PUT') {
      const name = String(req.headers['x-file-name'] ?? 'upload.bin');
      const mimeType = String(req.headers['content-type'] ?? 'application/octet-stream');
      return json(res, 201, {
        file: {
          id: 'abcdef0123456789abcdef0123456789',
          name,
          mimeType,
          size: raw.byteLength,
          url: '/api/v1/uploads/abcdef0123456789abcdef0123456789-' + name,
          uploadedBy: IDS.user
        }
      });
    }

    let match = /^\/api\/v1\/documents\/([^/]+)\/export$/.exec(path);
    if (match && method === 'GET') {
      const format = url.searchParams.get('format') ?? 'markdown';
      if (format === 'markdown') {
        return json(res, 200, {
          documentId: decodeURIComponent(match[1]),
          format: 'markdown',
          filename: 'quarterly-plan.md',
          content: '# Quarterly plan\n\nQuarterly plan body\n'
        });
      }
      return json(res, 200, {
        documentId: decodeURIComponent(match[1]),
        format: 'html',
        filename: 'quarterly-plan.html',
        content: '<!doctype html><html><body><h1>Quarterly plan</h1></body></html>'
      });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/activity$/.exec(path);
    if (match && method === 'GET') {
      return json(res, 200, {
        activity: [
          { id: 'act-1', userId: IDS.user, userName: 'Ada Lovelace', action: 'view', createdAt: '2026-01-03T10:00:00.000Z' },
          { id: 'act-2', userId: IDS.otherUser, userName: 'Grace Hopper', action: 'edit', createdAt: '2026-01-04T10:00:00.000Z' }
        ]
      });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/acl$/.exec(path);
    if (match) {
      if (method === 'GET') {
        return json(res, 200, {
          restricted: true,
          permissions: [{ userId: IDS.user, email: user.email, name: user.name, role: 'owner' }]
        });
      }
      if (method === 'PUT') return json(res, 200, { ok: true });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/comments$/.exec(path);
    if (match) {
      if (method === 'GET') {
        return json(res, 200, {
          comments: [
            {
              id: IDS.comment,
              parentId: null,
              body: 'Can we split this section?',
              anchor: null,
              status: 'open',
              resolvedAt: null,
              resolvedBy: null,
              createdAt: '2026-01-03T11:00:00.000Z',
              updatedAt: '2026-01-03T11:00:00.000Z',
              userId: IDS.user,
              userName: 'Ada Lovelace'
            }
          ]
        });
      }
      if (method === 'POST') {
        return json(res, 201, {
          comment: {
            id: IDS.comment,
            parentId: body?.parentId ?? null,
            body: body?.body ?? '',
            anchor: null,
            status: 'open',
            resolvedAt: null,
            resolvedBy: null,
            createdAt: '2026-01-05T10:00:00.000Z',
            updatedAt: '2026-01-05T10:00:00.000Z',
            userId: IDS.user,
            userName: 'Ada Lovelace'
          }
        });
      }
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/comments\/([^/]+)$/.exec(path);
    if (match && method === 'PATCH') {
      return json(res, 200, {
        comment: {
          id: decodeURIComponent(match[2]),
          parentId: null,
          body: 'Can we split this section?',
          anchor: null,
          status: body?.status ?? 'open',
          resolvedAt: body?.status === 'resolved' ? '2026-01-06T10:00:00.000Z' : null,
          resolvedBy: body?.status === 'resolved' ? IDS.user : null,
          createdAt: '2026-01-03T11:00:00.000Z',
          updatedAt: '2026-01-06T10:00:00.000Z',
          userId: IDS.user,
          userName: 'Ada Lovelace'
        }
      });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/versions$/.exec(path);
    if (match && method === 'GET') {
      return json(res, 200, {
        versions: [
          {
            id: IDS.version,
            version: 2,
            title: 'Quarterly plan',
            content: paragraphContent,
            createdBy: IDS.user,
            createdAt: '2026-01-02T09:00:00.000Z'
          }
        ]
      });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/versions\/([^/]+)\/restore$/.exec(path);
    if (match && method === 'POST') {
      const document = state.documents.get(decodeURIComponent(match[1]));
      if (!document) return fail(res, 404, 'NOT_FOUND', 'Document was not found.');
      if (body?.expectedVersion !== document.version) return versionConflict(res, document.version);
      document.version += 1;
      return json(res, 200, { document });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/versions\/([^/]+)$/.exec(path);
    if (match && method === 'GET') {
      if (decodeURIComponent(match[2]) !== IDS.version) return fail(res, 404, 'VERSION_NOT_FOUND', 'Version was not found.');
      return json(res, 200, {
        version: {
          id: IDS.version,
          documentId: decodeURIComponent(match[1]),
          version: 2,
          title: 'Quarterly plan',
          content: paragraphContent,
          createdBy: IDS.user,
          createdByName: 'Ada Lovelace',
          createdAt: '2026-01-02T09:00:00.000Z'
        }
      });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/duplicate$/.exec(path);
    if (match && method === 'POST') {
      const source = state.documents.get(decodeURIComponent(match[1]));
      if (!source) return fail(res, 404, 'NOT_FOUND', 'Document was not found.');
      const created = baseDocument({
        id: IDS.created,
        title: body?.title ?? source.title + ' (copy)',
        version: 1,
        content: source.content
      });
      state.documents.set(created.id, created);
      return json(res, 201, { document: created });
    }
    match = /^\/api\/v1\/documents\/([^/]+)\/favorite$/.exec(path);
    if (match && method === 'PUT') return json(res, 200, { favorite: body?.favorite === true });
    match = /^\/api\/v1\/documents\/([^/]+)\/restore$/.exec(path);
    if (match && method === 'POST') return json(res, 200, { ok: true });
    match = /^\/api\/v1\/documents\/([^/]+)\/permanent$/.exec(path);
    if (match && method === 'DELETE') return json(res, 200, { ok: true });

    match = /^\/api\/v1\/documents\/([^/]+)$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (id === IDS.forbidden) return fail(res, 403, 'FORBIDDEN', 'You do not have permission for this operation.');
      const document = state.documents.get(id);
      if (!document) return fail(res, 404, 'NOT_FOUND', 'Document was not found.');
      if (method === 'GET') return json(res, 200, { document });
      if (method === 'PUT') {
        if (body?.expectedVersion !== document.version) return versionConflict(res, document.version);
        if (typeof body.title === 'string') document.title = body.title;
        if ('parentId' in (body ?? {})) document.parentId = body.parentId;
        if (body?.content) document.content = body.content;
        document.version += 1;
        document.updatedAt = '2026-01-07T10:00:00.000Z';
        return json(res, 200, { document });
      }
      if (method === 'DELETE') return json(res, 200, { ok: true });
    }

    return fail(res, 404, 'NOT_FOUND', 'No mock route for ' + method + ' ' + path + '.');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: 'http://127.0.0.1:' + port,
    state,
    close: () => new Promise(resolve => server.close(() => resolve()))
  };
}
