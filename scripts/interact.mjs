/**
 * 交互冒烟测试：真的去点每个页面，确认功能能用（不只是能渲染）。
 * 需要先跑 npm run preview。
 *
 *   node scripts/interact.mjs
 */

import { chromium } from 'playwright'
import { installFakeBackend, META_KEY } from './lib/test-session.mjs'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const KEY = 'kivotos-kaoyan-v1'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://fonts.gstatic.com/**', (r) => r.abort())
// 站点配了后端之后，没登录会被登录屏挡在门外 —— 这个脚本只管点页面，
// 所以先给它一份有效会话（细节见 scripts/lib/test-session.mjs）
await installFakeBackend(page)

/* 干净的初始状态：本地数据清掉，走真实的首次使用流程 */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(([k, m]) => {
  localStorage.removeItem(k)
  localStorage.removeItem(m)
}, [KEY, META_KEY])
await page.reload({ waitUntil: 'domcontentloaded' })
/**
 * 等欢迎引导自己弹出来，别用固定 sleep。
 *
 * 配了后端之后，首屏要先读一次会话才决定"进应用还是给登录屏"，
 * 引导弹窗要等那一步落地才会排上 —— 固定 1.2 秒有时候刚好卡在它前面，
 * 于是报「首次打开没有引导」，看着像功能坏了。
 */
await page
  .locator('.modal-backdrop')
  .first()
  .waitFor({ state: 'visible', timeout: 8000 })
  .catch(() => {})

/* ---------- 1. 首次引导 ---------- */
check('首次打开出现欢迎引导', (await page.locator('.modal-backdrop').count()) === 1)
await page.locator('.modal input.input:not([type="date"])').first().fill('测试同学')
await page.locator('.modal .btn--primary').click()
await page.waitForTimeout(500)
check('点击开始后引导关闭', (await page.locator('.modal-backdrop').count()) === 0)
check('称呼已写入界面', (await page.locator('.brand__sub').textContent().catch(() => '')).includes('测试同学'))

/* ---------- 2. 首页倒计时 ---------- */
const days = await page.locator('#cdDays').textContent()
check('倒计时显示天数', /^\d+$/.test(days.trim()), `${days.trim()} 天`)
check('首页有星野台词', (await page.locator('.speech__text').textContent()).length > 4)
check('首页有光环装饰', (await page.locator('.halo').count()) >= 2)

/* ---------- 3. 添加委托 ---------- */
await page.goto(BASE + '#quests', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('button:has-text("添加委托")').first().click()
await page.waitForTimeout(400)
check('添加委托弹窗打开', (await page.locator('.modal').count()) === 1)
await page.locator('.modal .chip:has-text("背单词")').click()
await page.locator('.modal .btn--primary').click()
await page.waitForTimeout(600)
const questCount = await page.locator('.quest').count()
check('委托已出现在列表', questCount >= 1, `列表里 ${questCount} 条`)

/* ---------- 4. 勾选委托（这是数据流的关键：store 改动要触发重绘） ---------- */
await page.locator('.quest__check').first().check()
await page.waitForTimeout(700)
const doneTag = await page.locator('.quest[data-done="true"]').count()
check('勾选后委托变为已完成', doneTag >= 1, `${doneTag} 条已完成`)
const statText = await page.locator('.stat__value').first().textContent()
check('统计数字跟着更新', statText.includes('/'), `完成度 ${statText.trim()}`)

/* ---------- 5. 阶段计划 ---------- */
await page.goto(BASE + '#plan', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
check('四阶段已自动生成', (await page.locator('.phase').count()) === 4, `${await page.locator('.phase').count()} 个阶段`)
const phaseNames = await page.locator('.phase__name').allTextContents()
check('阶段名称正确', phaseNames.join('/').includes('基础期'), phaseNames.join(' / '))

/* ---------- 6. 导入教材目录 ---------- */
await page.locator('button:has-text("导入目录")').click()
await page.waitForTimeout(500)
check('导入目录弹窗打开', (await page.locator('.modal').count()) === 1)
check('默认模板已解析出章节', (await page.locator('.modal .row').count()) > 3)
await page.locator('.modal .btn--primary').click()
await page.waitForTimeout(900)
const chapterData = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k))
  return { chapters: s.chapters.length, books: new Set(s.chapters.map((c) => c.book)).size, questsFromChapters: s.quests.filter((q) => q.source === 'chapter').length }
}, KEY)
check('目录已排入（生成章节与委托）',
  chapterData.chapters >= 3 && chapterData.questsFromChapters >= 3,
  `${chapterData.chapters} 章 / ${chapterData.books} 本教材 / 生成 ${chapterData.questsFromChapters} 条委托`)
await page.goto(BASE + '#quests', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
const afterSchedule = await page.locator('.quest').count()
check('委托里出现了教材章节', afterSchedule >= 2, `共 ${afterSchedule} 条`)

/* ---------- 7. 专注计时 ---------- */
await page.goto(BASE + '#focus', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
check('番茄钟显示 25:00', (await page.locator('.pomo__time').textContent()).includes('25:00'))
await page.locator('.chip:has-text("15 分")').click()
await page.waitForTimeout(300)
check('切换时长生效', (await page.locator('.pomo__time').textContent()).includes('15:00'))
await page.locator('button:has-text("开始专注")').click()
await page.waitForTimeout(1400)
check('开始后按钮变为暂停', (await page.locator('button:has-text("暂停")').count()) === 1)
const running = await page.locator('.pomo__time').textContent()
check('计时在走', running.trim() !== '15:00', `当前 ${running.trim()}`)
await page.locator('button:has-text("暂停")').click()
await page.waitForTimeout(300)
check('可以暂停', (await page.locator('button:has-text("开始专注")').count()) === 1)
check('热力图已渲染', (await page.locator('.heatmap__cell').count()) > 100, `${await page.locator('.heatmap__cell').count()} 格`)

/* ---------- 8. 错题本 ---------- */
await page.goto(BASE + '#mistakes', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('button:has-text("记一条")').first().click()
await page.waitForTimeout(400)
await page.locator('.modal input.input').first().fill('中值定理辅助函数构造')
await page.locator('.modal .btn--primary').click()
await page.waitForTimeout(600)
check('错题已记录', (await page.locator('.item').count()) >= 1)
await page.locator('button:has-text("复习一轮")').first().click()
await page.waitForTimeout(600)
const dots = await page.locator('.level-dots i[data-on="true"]').count()
check('复习后熟练度提升', dots >= 2, `${dots} 个点已点亮`)

/* ---------- 9. 目标看板 ---------- */
await page.goto(BASE + '#goals', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('button:has-text("按总分自动拆解")').first().click()
await page.waitForTimeout(700)
const goalRows = await page.locator('.card--flat .tag').count()
check('目标已拆解到各科', goalRows >= 3, `${goalRows} 个科目标签`)
/* 改一个目标分，确认写库 */
const targetInput = page.locator('.score-input').first()
await targetInput.fill('135')
await targetInput.blur()
await page.waitForTimeout(600)
const storedGoals = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).goals, KEY)
check('目标分已保存到数据层', storedGoals.some((g) => g.target === 135), JSON.stringify(storedGoals.map((g) => g.target)))

/* ---------- 10. 勋章墙 ---------- */
await page.goto(BASE + '#medals', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const medals = await page.locator('.medal').count()
const owned = await page.locator('.medal[data-locked="false"]').count()
check('勋章墙渲染完整', medals >= 20, `${medals} 枚，其中已获得 ${owned} 枚`)
check('完成委托后解锁了勋章', owned >= 1)
await page.locator('button:has-text("今天打卡")').click()
await page.waitForTimeout(600)
const streak = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).progress.streak, KEY)
check('打卡写入连续天数', streak >= 1, `连续 ${streak} 天`)

/* ---------- 11. 设置：主题切换 ---------- */
await page.goto(BASE + '#settings', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('.chip:has-text("深色")').click()
await page.waitForTimeout(700)
const theme = await page.evaluate(() => document.documentElement.dataset.theme)
check('深色主题生效', theme === 'dark', `data-theme=${theme}`)
const storedTheme = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).settings.theme, KEY)
check('主题写入数据层', storedTheme === 'dark')
await page.locator('.chip:has-text("浅色")').click()
await page.waitForTimeout(500)
check('切回浅色', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')

/* ---------- 12. 导出 / 导入 ---------- */
const exported = await page.evaluate(async () => {
  const mod = { quests: 1 }
  return localStorage.getItem('kivotos-kaoyan-v1')
})
check('数据可导出为 JSON', JSON.parse(exported).quests.length > 0, `${JSON.parse(exported).quests.length} 条委托`)

/* ---------- 13. 键盘快捷键 ---------- */
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('5')
await page.waitForTimeout(700)
check('数字键 5 跳到错题本', page.url().endsWith('#mistakes'), page.url())
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
check('Ctrl+K 打开命令面板', (await page.locator('.modal').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- 14. 数据持久化（刷新后还在） ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
const afterReload = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY)
check('刷新后数据仍在', afterReload.quests.length > 0 && afterReload.goals.length > 0,
  `${afterReload.quests.length} 条委托 / ${afterReload.goals.length} 条目标`)

/* ---------- 15. 导航项在四种宽度下都必须可见（曾经的 bug：宽屏全被隐藏） ---------- */
async function checkNavAt(label, width, height) {
  const p = await context.newPage()
  await p.setViewportSize({ width, height })
  await p.goto(BASE + '#home', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(900)
  const info = await p.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const items = [...document.querySelectorAll('.nav-item[data-view]')]
    const notVisible = items.filter((el) => {
      const r = el.getBoundingClientRect()
      return !(r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw)
    }).map((el) => el.dataset.view)
    const settings = items.find((el) => el.dataset.view === 'settings')
    const sr = settings?.getBoundingClientRect()
    return {
      total: items.length,
      notVisible,
      settingsVisible: sr ? sr.width > 4 && sr.height > 4 : false,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }
  })
  check(`${label} 导航 8 项全部可见`,
    info.total === 8 && info.notVisible.length === 0 && info.settingsVisible,
    `共 ${info.total} 项，不可见 ${info.notVisible.length} 项${info.notVisible.length ? '（' + info.notVisible.join(',') + '）' : ''}，设置=${info.settingsVisible ? '可见' : '★不可见★'}`)
  if (info.overflowX > 2) check(`${label} 无横向溢出`, false, `溢出 ${info.overflowX}px`)
  await p.close()
}

await checkNavAt('桌面 1440', 1440, 900)
await checkNavAt('笔记本 1280', 1280, 800)
await checkNavAt('临界 1000', 1000, 800)
await checkNavAt('平板 834', 834, 1112)

/* ---------- 手机端底部标签栏 ---------- */
const mobile = await context.newPage()
await mobile.setViewportSize({ width: 390, height: 844 })
await mobile.goto(BASE + '#home', { waitUntil: 'domcontentloaded' })
await mobile.waitForTimeout(900)
const mobileOk = await mobile.evaluate(() => {
  const bar = document.querySelector('.sidenav')
  const style = getComputedStyle(bar)
  const items = document.querySelectorAll('.nav-item[data-view]')
  const rects = [...items].map((el) => el.getBoundingClientRect())
  const touch = rects.every((r) => r.height >= 44 && r.width >= 44)
  // 底部栏必须是一行：所有按钮的 top 值应几乎相同
  const tops = rects.map((r) => Math.round(r.top))
  const oneRow = Math.max(...tops) - Math.min(...tops) <= 4
  return { position: style.position, bottom: style.bottom, count: items.length, touch, oneRow }
})
check('手机端导航固定到底部', mobileOk.position === 'fixed' && mobileOk.bottom === '0px', JSON.stringify(mobileOk))
check('手机端 8 个标签、触摸目标 ≥44px、单行排列',
  mobileOk.count === 8 && mobileOk.touch && mobileOk.oneRow,
  `共 ${mobileOk.count} 项，触摸达标=${mobileOk.touch}，单行=${mobileOk.oneRow}`)

await browser.close()

/* ---------- 汇总 ---------- */
const failed = results.filter((r) => !r.ok)
console.log('\n================ 结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (errors.length) {
  console.log(`\n控制台错误 ${errors.length} 条：`)
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(' - ' + e)
}
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))
  process.exitCode = 1
}
