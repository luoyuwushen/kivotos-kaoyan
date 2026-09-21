import { defineConfig, loadEnv } from 'vite'

/**
 * 构建期提示：如果这次构建会把 Supabase 配置写进产物，明确说一下。
 *
 * 为什么要提示而不是拦下：
 *   「把配置编进产物」在**本地自用**时是想要的行为（打开站点就已经配好），
 *   所以普通 `npm run build` 不该被阻止 —— 真正危险的是把这个产物**推到公开的
 *   GitHub Pages**，那样所有访客都会被指向你的项目。所以：
 *     · 普通构建 → 放行 + 大声警告（就是这里）
 *     · 上线脚本 → 直接拒绝，除非显式加 -AskCredentials / -BakeSupabaseConfig
 *   两边配合起来，才不会出现「文档让你跑 npm run build，脚本却把你挡住」这种自相矛盾。
 */
function warnIfBakingSupabase(env) {
  const url = String(env.VITE_SUPABASE_URL || '').trim()
  const anon = String(env.VITE_SUPABASE_ANON_KEY || '').trim()
  return {
    name: 'kivotos-warn-baked-supabase',
    apply: 'build',
    configResolved() {
      if (!url || !anon) return
      const line = '─'.repeat(64)
      console.log(`\n${line}`)
      console.log('  ⚠  这次构建把 Supabase 配置写进了产物')
      console.log(`     项目：${url}`)
      console.log('')
      console.log('     · 本地自己用 / 自己跑 preview → 这正是想要的效果，忽略即可')
      console.log('     · 要推到公开的 GitHub Pages → 注意所有访客打开站点都会连到这个项目')
      console.log('       （数据仍然各归各的：RLS 保证每个人只能读写自己那一行）')
      console.log('     · 不想编进去 → 删掉或改名 .env.local 后重新构建')
      console.log(`${line}\n`)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // 用相对路径，这样部署到 GitHub Pages 的子目录（用户名.github.io/仓库名）
    // 或者直接双击 dist/index.html 本地打开，都能正常工作。
    base: './',
    plugins: [warnIfBakingSupabase(env)],
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
  }
})
