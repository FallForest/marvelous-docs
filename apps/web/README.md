# Marvelous Docs Web

React, TypeScript, Vite and Tiptap client for the self-hosted docs service.

```sh
npm install
npm run dev
```

`VITE_API_URL` optionally sets the API origin; it defaults to the current origin. Set `VITE_COLLAB_URL` to the Yjs `y-websocket` endpoint to enable collaborative editing; the JWT is sent as the websocket `token` query parameter. The Compose nginx proxy routes to the `api` service on ports 3000 and 1234. Without a collaboration URL, edits are saved through the versioned document API with optimistic version checks.
