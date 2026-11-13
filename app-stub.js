(() => {
  const now = new Date().toISOString();
  const mk = (id, title) => ({ id, title, kind: 'document', parentId: null, version: 1, createdAt: now, updatedAt: now,
    content: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] } }, createdBy: 'u1' });
  const DOCS = [mk('d1', 'AAA'), mk('d2', 'BBB')];
  const USER = { id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === '/api/v1/me') return json({ user: USER });
    if (path === '/api/v1/documents') return json({ documents: DOCS });
    if (path === '/api/v1/documents/favorites') return json({ documents: [] });
    if (path === '/api/v1/documents/trash') return json({ documents: [] });
    if (path === '/api/v1/workspace/stats') return json({ stats: { documents: 2, folders: 0, members: 1, openComments: 0, trashed: 0 } });
    if (path === '/api/v1/workspace/members') return json({ members: [] });
    if (path === '/api/v1/templates') return json({ templates: [] });
    if (/comments|versions|activity|acl|share-links/.test(path)) return json({ comments: [], versions: [], activity: [], permissions: [], restricted: false, shareLinks: [] });
    if (/^\/api\/v1\/documents\/[^/]+$/.test(path)) { const id = path.split('/').pop(); return json({ document: DOCS.find(d => d.id === id) || DOCS[0] }); }
    return json({});
  };
  localStorage.setItem('mdocs-token', 'stub');
})()