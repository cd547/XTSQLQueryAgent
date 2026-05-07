import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'antd': ['antd'],
          'monaco-editor': ['@monaco-editor/react', 'monaco-editor'],
          'xlsx': ['xlsx'],
          'react-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  },
  css: {
    devSourcemap: false
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true
      }
    }
  }
})