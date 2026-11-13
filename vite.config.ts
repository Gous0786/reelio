import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['mediabunny'] },
  appType: 'mpa', // the site has two real pages; unknown paths 404 instead of falling back to the app
  build: {
    rollupOptions: {
      // the app, plus static landing pages that load no app code
      input: { main: resolve(import.meta.dirname, 'index.html'), gta6: resolve(import.meta.dirname, 'gta-6-clip-maker.html') },
    },
  },
})
