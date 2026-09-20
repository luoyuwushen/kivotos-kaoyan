import { defineConfig } from 'vite'

// 用相对路径，这样部署到 GitHub Pages 的子目录（用户名.github.io/仓库名）
// 或者直接双击 dist/index.html 本地打开，都能正常工作。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false
  },
  preview: {
    port: 4173,
    host: '127.0.0.1'
  }
})
