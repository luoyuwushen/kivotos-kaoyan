/**
 * 分数满分规则测试：确认数学/专业课 150、英语/政治 100，
 * 并且老数据里被写错成 150 的英语/政治能被自动校正。
 *
 *   node scripts/test-scores.mjs
 *
 * 用浏览器跑，因为数据层依赖 localStorage 和 DOM。
 * 需要先 npm run preview。
 */

import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const KEY = 'kivotos-kaoyan-v1'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 造一份「被旧版本写坏」的数据：英语和政治的满分是 150 */
function brokenState() {
  return {
    version: 1,
    profile: { nickname: 'T', siteName: 'T', targetSchool: '', targetMajor: '', examDate: '2027-12-26', subjectSet: 'math1', dailyGoalMin: 360 },
    quests: [], phases: [], chapters: [], focus: [], mistakes: [],
    goals: [
      { subject: 'math', target: 120, current: 96, full: 150 },
      { subject: 'english', target: 170, current: 61, full: 150 },   // 错：英语满分应是 100，target 也超标
      { subject: 'politics', target: 70, current: 58, full: 150 },   // 错：政治满分应是 100
      { subject: 'major', target: 120, current: 88, full: 150 }
    ],
    scores: [],
    progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 },
    medals: { unlocked: {} },
    settings: { theme: 'light', mascots: { hoshino: true }, aiApi: {}, sync: {} },
    onboarded: true
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

/* ---------- 1. 打开目标看板，检查满分显示 ---------- */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(brokenState())])
await page.goto(BASE + '#goals', { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

// 逐科读出「满分 xxx」，确认是 150 / 100 / 100 / 150 这个顺序
const fullMarks = await page.evaluate(() =>
  [...document.querySelectorAll('.card--flat')]
    .map((card) => {
      const tag = card.querySelector('.tag')?.textContent?.trim() || ''
      const text = card.querySelector('.dim-2')?.textContent?.trim() || ''
      const m = /满分\s*(\d+)/.exec(text)
      return m ? `${tag}:${m[1]}` : null
    })
    .filter(Boolean)
)
check('各科满分显示正确（数 150 / 英 100 / 政 100 / 专 150）',
  fullMarks.join(' ') === '数学:150 英语:100 政治:100 专业课:150',
  fullMarks.join(' '))

const totalsLine = (await page.locator('.card .dim-2').allTextContents()).find((t) => t.includes('四科满分合计')) || ''
check('四科满分合计为 500', totalsLine.includes('500'), totalsLine.trim())

/* ---------- 2. 超标提示与一键修正 ---------- */
const warnTag = await page.locator('.tag--warn').first().textContent().catch(() => '')
check('检测到满分有误并提示', warnTag.includes('满分有误'), warnTag.trim())

await page.locator('button:has-text("一键修正")').click()
await page.waitForTimeout(900)
const afterFix = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).goals, KEY)
const english = afterFix.find((g) => g.subject === 'english')
const politics = afterFix.find((g) => g.subject === 'politics')
const math = afterFix.find((g) => g.subject === 'math')
const major = afterFix.find((g) => g.subject === 'major')
check('英语满分校正为 100', english.full === 100, `full=${english.full}`)
check('政治满分校正为 100', politics.full === 100, `full=${politics.full}`)
check('数学满分保持 150', math.full === 150, `full=${math.full}`)
check('专业课满分保持 150', major.full === 150, `full=${major.full}`)
check('英语超标目标分被压回 100', english.target <= 100, `target=${english.target}`)

/* ---------- 3. 手动改分数，确认满分不会被改坏 ---------- */
const inputs = page.locator('.score-input')
await inputs.nth(0).fill('130')
await inputs.nth(0).blur()
await page.waitForTimeout(800)
const afterEdit = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).goals, KEY)
check('手动改目标分后满分仍正确',
  afterEdit.every((g) => g.full === (g.subject === 'english' || g.subject === 'politics' ? 100 : 150)),
  afterEdit.map((g) => `${g.subject}:${g.full}`).join(' '))

/* ---------- 4. 从零设定总分目标（这条路径以前会写错满分） ---------- */
await page.evaluate(([k, v]) => {
  const s = JSON.parse(v)
  s.goals = []
  localStorage.setItem(k, JSON.stringify(s))
}, [KEY, JSON.stringify(brokenState())])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('清空后显示空状态引导', (await page.locator('button:has-text("按总分自动拆解")').count()) >= 1)

await page.locator('button:has-text("设定总分目标")').click()
await page.waitForTimeout(500)
const capText = await page.locator('.modal .field__label').first().textContent()
check('总分弹窗标注满分 500', capText.includes('500'), capText.trim())
await page.locator('.modal .btn--primary').click()
await page.waitForTimeout(1000)

const fresh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).goals, KEY)
const freshEnglish = fresh.find((g) => g.subject === 'english')
const freshMath = fresh.find((g) => g.subject === 'math')
check('全新拆解路径：英语满分 100', freshEnglish?.full === 100, `full=${freshEnglish?.full}`)
check('全新拆解路径：数学满分 150', freshMath?.full === 150, `full=${freshMath?.full}`)
check('全新拆解路径：英语目标不超 100', (freshEnglish?.target ?? 0) <= 100, `target=${freshEnglish?.target}`)

/* ---------- 5. 不考数学时满分合计 350 ---------- */
await page.goto(BASE + '#settings', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const setSelect = page.locator('.card select').first()
await setSelect.selectOption('no-math')
await page.waitForTimeout(800)
await page.goto(BASE + '#goals', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.locator('button:has-text("设定总分目标")').click()
await page.waitForTimeout(500)
const capText2 = await page.locator('.modal .field__label').first().textContent()
check('不考数学时总分满分为 350', capText2.includes('350'), capText2.trim())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log('\n================ 结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (errors.length) {
  console.log(`\n控制台错误 ${errors.length} 条：`)
  for (const e of [...new Set(errors)].slice(0, 8)) console.log(' - ' + e)
}
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))
  process.exitCode = 1
}
