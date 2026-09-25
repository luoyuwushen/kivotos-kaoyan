/**
 * 定位角色：把骨骼按名字前缀分组，量每组的骨世界范围，再围绕角色取景。
 *
 * 之前的教训：
 *   · 用 boneBounds 取景会偏（骨骼范围 ≠ 可见范围）
 *   · 用全部附件顶点取景会太小（场景里的道具把包围盒撑得很大，
 *     而参考图 thumb-*.png 是**近景**：两个角色 + 桌椅 + 海景，不是整间教室）
 *   · Math.min(cw/bw, ch/bh) 是 fit 语义会缩太小，要 fill/cover 用 Math.max
 *
 *   node scripts/probe-shittim-hero.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-hero')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 480, height: 270 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

/** 列出骨骼分组及每组的世界范围 */
const bones = await page.evaluate(() => {
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  const groups = {}
  for (const b of item.skeleton.bones) {
    const parts = b.data.name.split('_')
    const key = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : parts[0]
    const g = (groups[key] = groups[key] || { n: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    g.n++
    if (b.worldX < g.minX) g.minX = b.worldX
    if (b.worldX > g.maxX) g.maxX = b.worldX
    if (b.worldY < g.minY) g.minY = b.worldY
    if (b.worldY > g.maxY) g.maxY = b.worldY
  }
  return Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      {
        bones: g.n,
        box: [Math.round(g.minX), Math.round(g.minY), Math.round(g.maxX), Math.round(g.maxY)],
        size: [Math.round(g.maxX - g.minX), Math.round(g.maxY - g.minY)],
        center: [Math.round((g.minX + g.maxX) / 2), Math.round((g.minY + g.maxY) / 2)]
      }
    ])
  )
})

console.log('=== 骨骼分组（office-day / Idle_00）===')
for (const [k, v] of Object.entries(bones).sort((a, b) => b[1].bones - a[1].bones)) {
  console.log(
    `  ${k.padEnd(14)} ${String(v.bones).padStart(3)} 根  范围 ${v.box.join(',')}` +
      `  尺寸 ${v.size.join('×')}  中心 ${v.center.join(',')}`
  )
}

/** 围绕指定分组取景并拍照 */
const shotAround = (keys, padFactor) =>
  page.evaluate(
    async ({ keys, padFactor }) => {
      const st = window.__scene.stage()
      const item = st.items.get('office-day')
      window.__scene.only(['office-day'])
      item.state.setAnimation(0, 'Idle_00', true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }
      st.resize()

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const b of item.skeleton.bones) {
        const parts = b.data.name.split('_')
        const key = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : parts[0]
        if (!keys.includes(key)) continue
        if (b.worldX < minX) minX = b.worldX
        if (b.worldX > maxX) maxX = b.worldX
        if (b.worldY < minY) minY = b.worldY
        if (b.worldY > maxY) maxY = b.worldY
      }
      if (!Number.isFinite(minX)) return { error: '这些分组没有骨骼' }

      const cw = st.canvas.width
      const ch = st.canvas.height
      const bw = Math.max(maxX - minX, 1)
      const bh = Math.max(maxY - minY, 1)
      // cover 语义：Math.max 保证画面被填满（fit 用 min 会缩太小、四周留白）
      const zoom = Math.max(cw / bw, ch / bh) * padFactor
      st.camera.zoom = zoom
      st.camera.position.x = (minX + maxX) / 2
      st.camera.position.y = (minY + maxY) / 2
      st.camera.update()
      return {
        box: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
        size: [Math.round(bw), Math.round(bh)],
        zoom: +zoom.toFixed(5),
        visible: [Math.round(cw / zoom), Math.round(ch / zoom)],
        dataUrl: st.snapshot()
      }
    },
    { keys, padFactor }
  )

const bigGroups = Object.entries(bones)
  .filter(([, v]) => v.bones >= 5)
  .sort((a, b) => b[1].bones - a[1].bones)
  .map(([k]) => k)

// 逐个分组单独取景（找出角色在哪一组）
for (const g of bigGroups.slice(0, 8)) {
  const r = await shotAround([g], 1.0)
  if (r.error) continue
  await writeFile(join(OUT, `around-${g}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  console.log(`  围绕 ${g.padEnd(14)} 范围 ${r.size.join('×').padEnd(12)} zoom ${r.zoom}  可见 ${r.visible.join('×')}`)
}

// 多个分组一起（角色 + 它们所在的桌椅）
for (const combo of [bigGroups.slice(0, 2), bigGroups.slice(0, 3), bigGroups.slice(0, 5)]) {
  const r = await shotAround(combo, 1.0)
  if (r.error) continue
  const name = 'combo-' + combo.join('+') + '.png'
  await writeFile(join(OUT, name), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  console.log(`  ${name.padEnd(34)} 范围 ${r.size.join('×').padEnd(12)} zoom ${r.zoom}`)
}

console.log('\n输出目录:', OUT)
await browser.close()
