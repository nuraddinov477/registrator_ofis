import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // /mnt/c (Windows fs) da inotify ishlamaydi — polling bilan o'zgarishlarni kuzatamiz
    watch: { usePolling: true, interval: 300 },
  },
})
