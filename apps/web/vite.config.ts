import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Ships the WebP set and leaves the PNG originals out of the bundle.
 *
 * `public/art` holds two copies of every hand-drawn asset: the WebP the app
 * actually requests (styles/*.css and ArtIcon build `.webp` URLs) and the
 * original PNG, which exists so the gallery page and the design guide can offer
 * a "PNG ↓" download. Both were being copied into `dist`, so every deploy
 * carried 3.7 MB the app never reads next to 797 KB it does.
 *
 * The exclusion is a build-time copy filter rather than `publicDir: false`,
 * because that would drop the SVG favicon and the WebP set too. It also leaves
 * the sources in the repository, which is the point: the PNGs stay the
 * provenance of the artwork.
 *
 * One thing stops working in a production build: the "PNG ↓" links on the
 * design gallery page (/art/handdrawn-v1/index.html) now 404. That page's
 * documented use is opening it from the filesystem or through `vite dev` (see
 * docs/design/handdrawn-v1/asset-guide.md), and both still have the originals.
 * If it ever has to be browsable in production, copy the PNG tree into a
 * release asset instead of into the web image.
 */
function webpOnlyArt(): Plugin {
  return {
    name: 'webp-only-art',
    apply: 'build',
    // closeBundle runs after Vite has emptied outDir and copied publicDir into
    // it, so this is the first moment a filter can see the copied files and the
    // last one before the build is reported as done.
    async closeBundle() {
      const art = join(import.meta.dirname, 'dist/art')
      let entries: string[] = []
      try {
        entries = await readdir(art, { recursive: true })
      } catch {
        return // no art copied; nothing to prune
      }
      const pngs = entries.filter((entry) => entry.toLowerCase().endsWith('.png'))
      await Promise.all(pngs.map((entry) => rm(join(art, entry), { force: true })))
    },
  }
}

export default defineConfig({
  plugins: [react(), webpOnlyArt()],
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
