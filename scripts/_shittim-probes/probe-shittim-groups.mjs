/**
 * 把 office-day 的附件按「所属角色组」拆开渲染，定位角色到底在哪。
 *
 * 插槽名自带分组前缀（A_00_* / A_01_* / Black01_* / BG_*…），
 * 所以可以只显示某一组，逐组拍一张 —— 这比盯着一张大图猜快得多。
 *
 *   node scripts/probe-shittim-groups.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-groups')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 480, height: 480 }, locale: 'zh-CN' })
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

/** 列出 office-day 里带附件的插槽，按前缀分组 */
const groups = await page.evaluate(() => {
  // 注意：spine 的 Slot **没有** .name，名字在 slot.data.name 上。
  // 这个辅助必须写在 page.evaluate 内部 —— 外面 Node 作用域的函数进不来。
  const slotName = (slot) => slot?.data?.name || slot?.name || '(无名)'
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  const byGroup = {}
  for (const slot of item.skeleton.slots) {
    if (!slot.getAttachment()) continue
    // 取前两段作为分组键：A_00_x → A_00；Black01_x → Black01；BG_sky → BG
    const name = slotName(slot)
    const parts = name.split('_')
    const key = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : parts[0]
    ;(byGroup[key] = byGroup[key] || []).push(name)
  }
  return byGroup
})

console.log('=== Idle_00 下带附件的插槽分组 ===')
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(12)} ${String(v.length).padStart(3)} 个   例：${v.slice(0, 3).join(', ')}`)
}

/** 只保留指定分组，其余插槽附件清空，再拍一张 */
const shotGroup = (keepKeys) =>
  page.evaluate(
    async ({ keepKeys }) => {
      const slotName = (slot) => slot?.data?.name || slot?.name || '(无名)'
      const st = window.__scene.stage()
      const item = st.items.get('office-day')
      window.__scene.only(['office-day'])

      // 先跑一遍动画把姿态与附件挂上
      item.state.setAnimation(0, 'Idle_00', true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }

      /**
       * 关键：清附件必须在最后一次 state.apply() **之后**做。
       * apply() 会按动画的 attachment 时间线把插槽重新填上，
       * 先清后 apply 等于白清（第一版就是这么写的，六张图长得一模一样）。
       * 这里清完直接画，不再走 update/apply，姿态仍停在刚才那帧。
       */
      let kept = 0
      const keptNames = []
      for (const slot of item.skeleton.slots) {
        if (!slot.getAttachment()) continue
        const name = slotName(slot)
        const parts = name.split('_')
        const key = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : parts[0]
        if (!keepKeys.includes(key)) {
          slot.setAttachment(null)
        } else {
          kept++
          if (keptNames.length < 5) keptNames.push(name)
        }
      }
      item.skeleton.updateWorldTransform(st.core.Physics.update)
      st.resize()
      st.fitTo(st.boneBounds('office-day'))

      const url = st.snapshot()
      return { kept, keptNames, dataUrl: url }
    },
    { keepKeys }
  )

const topGroups = Object.entries(groups)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 6)
  .map(([k]) => k)

for (const g of topGroups) {
  const r = await shotGroup([g])
  await writeFile(join(OUT, `only-${g}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  console.log(`  只留 ${g.padEnd(12)} 保留插槽 ${r.kept}`)
}

// 只留背景（含 BG_ 与 Black_ 开头）
const bg = await shotGroup(['BG_sky', 'BG_class', 'Black_Floor', 'Black00', 'Black01', 'Black_class'])
await writeFile(join(OUT, 'only-background.png'), Buffer.from(bg.dataUrl.split(',')[1], 'base64'))
console.log(`\n只留背景 保留插槽 ${bg.kept}`)

console.log('\n输出目录:', OUT)
await browser.close()
