import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the packaged build via file://.../dist/index.html (see apps/desktop/src/
  // main.ts's loadFile calls), not an http server, so asset URLs must resolve relative to that
  // file rather than to root ("/assets/..." resolves to the filesystem root under file://, which
  // 404s everything and renders a blank window with no console-visible reason unless devtools are
  // opened). Root-relative paths still work fine in dev (served over http://localhost:5173).
  base: "./",
  plugins: [react()],
})
