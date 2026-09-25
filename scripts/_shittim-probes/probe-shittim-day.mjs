/**
 * 确认 office-day 的真实情况：
 *   · 不播动画时只有 11 个插槽带附件（那 11 个是背景白块 → 看起来"空白"）
 *   · 播 Idle_00 之后应该涨到 41 个
 *   · 两个贴图页是否都挂上了贴图（daytime 是两页图集）
 *
 *   node scripts/probe-shittim-day.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-day')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })
await page.evaluate(() => {
  document.querySelectorAll('pre').forEach((n) => (n.style.display = 'none'))
})

/** 统计 alpha 与内容 */
async function stats(label) {
  const url = await page.evaluate(() => window.__scene.snapshot())
  const buf = Buffer.from(url.split(',')[1], 'base64')
  await writeFile(join(OUT, `${label}.png`), buf)
  const info = await page.evaluate(async (u) => {
    const bin = atob(u.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let n = 0
    let hi = 0
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (!a) continue
      n++
      if (a > hi) hi = a
    }
    return { visiblePixels: n, maxAlpha: hi }
  }, url)
  console.log(`  ${label.padEnd(28)} 可见像素 ${String(info.visiblePixels).padStart(7)}  最大 alpha ${info.maxAlpha}`)
  return info
}

console.log('=== 贴图页状态 ===')
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...window.__scene.stage().items.entries()].map(([id, it]) => ({
        id,
        pages: it.atlas.pages.map((pg) => ({
          name: pg.name,
          size: `${pg.width}x${pg.height}`,
          hasTexture: Boolean(pg.texture),
          image: pg.texture?.getImage?.() ? `${pg.texture.getImage().width}x${pg.texture.getImage().height}` : null
        }))
      }))
    ),
    null,
    1
  )
)

console.log('\n=== 只显示 office-day ===')
await page.evaluate(() => window.__scene.only(['office-day']))
await stats('a-setup-pose')

for (const anim of ['Idle_00', 'Idle_03']) {
  const n = await page.evaluate((a) => {
    const st = window.__scene.stage()
    const item = st.items.get('office-day')
    item.state.setAnimation(0, a, true)
    for (let i = 0; i < 30; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }
    // 用附件顶点算包围盒再取景
    const { MeshAttachment, RegionAttachment } = st.core
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let attached = 0
    for (const slot of item.skeleton.slots) {
      const at = slot.getAttachment()
      if (!at || !slot.bone) continue
      attached++
      if (at instanceof MeshAttachment) {
        const wv = new Float32Array(at.worldVerticesLength)
        try {
          at.computeWorldVertices(slot, 0, at.worldVerticesLength, wv, 0, 2)
        } catch {
          continue
        }
        for (let i = 0; i < wv.length; i += 2) {
          const x = wv[i]
          const y = wv[i + 1]
          if (!Number.isFinite(x)) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      } else if (at instanceof RegionAttachment) {
        const s = Math.max(Math.abs(slot.bone.a), Math.abs(slot.bone.d), 1e-6)
        const hw = (Math.abs(at.width || 0) / 2) * s
        const hh = (Math.abs(at.height || 0) / 2) * s
        minX = Math.min(minX, slot.bone.worldX - hw)
        maxX = Math.max(maxX, slot.bone.worldX + hw)
        minY = Math.min(minY, slot.bone.worldY - hh)
        maxY = Math.max(maxY, slot.bone.worldY + hh)
      }
    }
    if (Number.isFinite(minX)) st.fitTo({ minX, minY, maxX, maxY })
    return { attached, box: Number.isFinite(minX) ? [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)] : null }
  }, anim)
  console.log(`  ${anim}: 带附件插槽 ${n.attached}  附件盒 ${JSON.stringify(n.box)}`)
  await stats(`b-${anim}`)
}

console.log('\n输出目录:', OUT)
await browser.close()
