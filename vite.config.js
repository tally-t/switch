import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev: proxy /api calls to the Vercel dev server
      '/api': 'http://localhost:3000'
    }
  }
})
