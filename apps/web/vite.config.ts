import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('y-prosemirror')) return 'tiptap'
          if (/node_modules[\\/](yjs|y-websocket|y-protocols|lib0)[\\/]/.test(id)) return 'yjs'
          if (id.includes('@tiptap') || id.includes('prosemirror-')) return 'tiptap'
          if (/node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
  server: {
    // Editors and atomic-write tools create transient directories that can be
    // locked on Windows; watching them crashes chokidar with EBUSY.
    watch: { ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**', '**/*.tmp/**'] },
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/collab': {
        target: 'ws://127.0.0.1:1234',
        ws: true,
      },
    },
  },
})