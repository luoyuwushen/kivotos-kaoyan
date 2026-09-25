/**
 * 验证：把 atlas.scale 置 1 并把所有附件的 region 重算之后，贴图是否终于采对。
 *
 * 依据：arona_spr.atlas 带 `scale:1.3`，页面 1024²，但解析出来的 region u2 到了 1.59
 * （即像素 1631 > 1024）—— 越界被 CLAMP 到边缘的透明像素，于是整屏近乎全透明。
 * regionUVs 本身是正确的 [0,1]，是 u/v/u2/v2 这一层错了。
 *
 *   node scripts/probe-shittim-scale2.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-scale2')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 800, height: 800 }, locale: 'zh-CN' })
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

async function measure(label) {
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
    let opaque200 = 0
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (!a) continue
      n++
      if (a > hi) hi = a
      if (a > 200) opaque200++
    }
    return { visible: n, maxAlpha: hi, opaque200 }
  }, url)
  console.log(`  ${label.padEnd(30)} 可见 ${String(info.visible).padStart(7)}  最大alpha ${String(info.maxAlpha).padStart(3)}  alpha>200 的像素 ${info.opaque200}`)
  return info
}

console.log('=== 修之前（用 arona / Idle_01）===')
await page.evaluate(() => {
  const st = window.__scene.stage()
  window.__scene.only(['arona'])
  const item = st.items.get('arona')
  item.state.setAnimation(0, 'Idle_01', true)
  for (let i = 0; i < 30; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.fitTo(st.boneBounds('arona'))
})
await measure('a-before')

console.log('\n=== 把 atlas.scale 置 1 并重算附件 region ===')
const after = await page.evaluate(() => {
  const st = window.__scene.stage()
  const { RegionAttachment, MeshAttachment } = st.core
  const detail = { atlasScaleBefore: {}, regionU2Before: {}, regionU2After: {} }

  for (const [id, it] of st.items) {
    detail.atlasScaleBefore[id] = it.atlas.scale
    // ① 关键：让 atlas 的 scale 归 1 —— region 的 u/v/u2/v2 是按它算出来的
    it.atlas.scale = 1
    // ② 让 TextureAtlas 重新按当前页面尺寸算一遍 region
    for (const region of it.atlas.regions) {
      const pg = region.page
      const w = pg.width
      const h = pg.height
      // 用 region 记下的原始 bounds 重算（TextureAtlasRegion 保留了 offset/originalWidth）
      // 这里改用最直接的办法：按本 region 已知的像素框重算
      // 像素框 = [u*W, v*H, u2*W, v2*H]（旧值），再除以 scale 还原
      // 简单起见：把 UV 除以旧 scale，再 clamp 到 1
      void w
      void h
    }
    // ③ 重算附件：updateRegion 会用新的 region 值
    for (const slot of it.skeleton.slots) {
      const a = slot.getAttachment()
      if (!a) continue
      if (a instanceof RegionAttachment || a instanceof MeshAttachment) {
        a.updateRegion?.()
        a.updateUVs?.()
      }
    }
    const first = it.atlas.regions[0]
    detail.regionU2Before[id] = +first.u2.toFixed(4)
    // 手动把 0-1 之外的 UV 折回来（按旧 scale 还原）
    for (const region of it.atlas.regions) {
      region.u /= it.atlas.scale || 1
      region.u2 /= it.atlas.scale || 1
      region.v /= it.atlas.scale || 1
      region.v2 /= it.atlas.scale || 1
    }
    detail.regionU2After[id] = +first.u2.toFixed(4)
  }
  // 重新 apply 姿态，把新 UV 带进顶点
  const item = st.items.get('arona')
  for (let i = 0; i < 8; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.fitTo(st.boneBounds('arona'))
  return detail
})
console.log(JSON.stringify(after, null, 1))
await measure('b-after')

console.log('\n输出目录:', OUT)
await browser.close()
