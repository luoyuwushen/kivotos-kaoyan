/**
 * 只查一件事：snapshot() 出来的 dataURL 解回像素后，到底有没有内容。
 *   node scripts/probe-shittim-px.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 600, height: 600 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

const out = await page.evaluate(async () => {
  const st = window.__scene.stage()
  window.__scene.only(['arona'])
  window.__scene.play('arona', 'Idle_01', true)
  const item = st.items.get('arona')
  for (let i = 0; i < 30; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }

  const url = st.snapshot()
  const info = { dataUrlLen: url.length, head: url.slice(0, 40) }

  // ① 用 createImageBitmap + OffscreenCanvas 解码（比 Image 更可控）
  const bin = atob(url.split(',')[1])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  info.bitmapSize = `${bmp.width}x${bmp.height}`

  const oc = new OffscreenCanvas(bmp.width, bmp.height)
  const octx = oc.getContext('2d', { willReadFrequently: true })
  octx.drawImage(bmp, 0, 0)
  const d = octx.getImageData(0, 0, bmp.width, bmp.height).data

  let opaque = 0
  let minX = bmp.width
  let minY = bmp.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (d[(y * bmp.width + x) * 4 + 3] < 10) continue
      opaque++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  info.opaquePixels = opaque
  info.bbox = opaque ? { minX, minY, maxX, maxY } : null
  info.canvasSize = `${st.canvas.width}x${st.canvas.height}`
  return info
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
