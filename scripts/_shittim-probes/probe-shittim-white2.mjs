/**
 * 找出把画面糊成纯白的那个附件/分组。
 *
 * 已知：`only(['office-day'])` 之后画面变成色数=1 的纯白（4 次 drawElements / 5535 索引）。
 * 不筛的时候（arona + office-day 都显示）色数是 19，画面正常。
 * 说明 office-day 里**存在一个覆盖全屏的白色大件**，只有在 arona 被隐藏后才暴露出来。
 *
 * 做法：逐个隐藏 office-day 的插槽，看哪一个被隐藏后色数回升 —— 那就是它。
 *
 *   node scripts/probe-shittim-white2.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-white2')
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
await page.evaluate(() => {
  document.querySelectorAll('pre').forEach((n) => (n.style.display = 'none'))
})

/** 摆好 office-day 的姿态，隐藏 arona，量当前帧的色数 */
const measure = (hideSlot) =>
  page.evaluate(async (hide) => {
    const st = window.__scene.stage()
    window.__scene.only(['office-day'])
    const item = st.items.get('office-day')

    // 每次都从头应用一遍，避免上一次的清空残留
    item.state.clearTracks()
    item.skeleton.setToSetupPose()
    item.state.setAnimation(0, 'Idle_00', true)
    for (let i = 0; i < 26; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }

    let hiddenName = null
    if (hide) {
      for (const slot of item.skeleton.slots) {
        const nm = slot?.data?.name || ''
        if (nm === hide) {
          slot.setAttachment(null)
          hiddenName = nm
        }
      }
    }
    item.skeleton.updateWorldTransform(st.core.Physics.update)
    st.resize()

    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const hist = new Map()
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
    return { hiddenName, colors: hist.size, dataUrl: url }
  }, hideSlot)

// 基线
const base = await measure(null)
console.log(`基线（只显示 office-day）色数 ${base.colors}`)

// 列出 office-day 在 Idle_00 下所有带附件的插槽名
const attached = await page.evaluate(() => {
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  item.state.clearTracks()
  item.skeleton.setToSetupPose()
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  return item.skeleton.slots
    .filter((s) => s.getAttachment())
    .map((s) => s.data.name)
})

console.log(`Idle_00 下带附件的插槽 ${attached.length} 个\n`)

const winners = []
for (const name of attached) {
  const r = await measure(name)
  if (r.colors > base.colors) {
    winners.push({ name, colors: r.colors })
    console.log(`  隐藏 ${name.padEnd(30)} → 色数回升到 ${r.colors}`)
  }
}

if (!winners.length) {
  console.log('  逐个隐藏都没能让色数回升 —— 不是单个附件的问题，可能是整体机位/缩放')
}

// 把色数最高的那个隐藏后的图存下来看
if (winners.length) {
  const top = winners.sort((a, b) => b.colors - a.colors)[0]
  const r = await measure(top.name)
  await writeFile(join(OUT, `hide-${top.name}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  console.log(`\n最多回升：隐藏 ${top.name} → 色数 ${r.colors}，已存图`)
}

console.log('输出目录:', OUT)
await browser.close()
