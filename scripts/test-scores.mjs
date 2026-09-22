/**
 * 分数满分规则测试（直接验证数据层，不经过页面）。
 *
 * 为什么不经页面：站点有强制登录门（src/views/login.js），未登录进不了 #goals，
 * 页面级断言会被门禁挡住。这里改为直接调用 src/lib/store.js 的导出函数，
 * 用 cache-busting 的动态 import 拿到**全新的模块实例**，从而得到干净初始状态。
 *
 *   node scripts/test-scores.mjs        （需 dev server：npx vite --port 4175）
 */

import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const KEY = 'kivotos-kaoyan-v1'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 造一份「被旧版本写坏」的数据：英语和政治的满分是 150，且目标分超标 */
const brokenState = {
  version: 1, onboarded: true,
  profile: { nickname: 'T', siteName: 'T', targetSchool: '', targetMajor: '', examDate: '2027-12-26', subjectSet: 'math1', dailyGoalMin: 360, studyStartDate: '' },
  quests: [], phases: [], chapters: [], focus: [], mistakes: [], scores: [],
  goals: [
    { subject: 'math', target: 120, current: 96, full: 150 },
    { subject: 'english', target: 170, current: 61, full: 150 },   // 错：英语满分应为 100，target 也超标
    { subject: 'politics', target: 70, current: 58, full: 150 },   // 错：政治满分应为 100
    { subject: 'major', target: 120, current: 88, full: 150 }
  ],
  progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 },
  medals: { unlocked: {} },
  settings: { theme: 'light', mascots: {}, customCharacters: false, aiApi: {}, sync: {} }
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

// 种入坏数据，再打开页面（dev server 才能提供 /src 模块）
await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [KEY, JSON.stringify(brokenState)])
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const canImport = await page.evaluate(async () => {
  try { await import('/src/lib/store.js'); return true } catch { return false }
})
if (!canImport) {
  console.log('\n跳过：当前服务不提供源码模块（需要 dev server，不是 preview）。')
  console.log(`  例如：npx vite --port 4175  然后 SMOKE_URL=http://127.0.0.1:4175/ node ${'scripts/test-scores.mjs'}`)
  await browser.close()
  process.exit(0)
}

let counter = 0
/** 拿一个全新的 store 模块实例（独立 load()，因此是干净初始状态） */
async function freshStore() {
  counter += 1
  return page.evaluate(async (n) => {
    const m = await import(`/src/lib/store.js?t=${n}`)
    return {
      subjects: m.SUBJECTS.map((s) => `${s.name}:${s.full}`),
      mathFull: m.subjectFull('math'),
      englishFull: m.subjectFull('english'),
      politicsFull: m.subjectFull('politics'),
      majorFull: m.subjectFull('major'),
      total500: m.totalFull('math1'),
      total350: m.totalFull('no-math'),
      // 全新状态：用 setGoal 写入目标，看满分怎么写
      afterSet: (() => {
        // 故意不传 full，模拟「设定总分目标」这条老路径
        m.setGoal({ subject: 'english', target: 70 })
        m.setGoal({ subject: 'math', target: 120 })
        return m.state.goals.map((g) => `${g.subject}:${g.full}/${g.target}`)
      })(),
      summary: m.goalSummary()
    }
  }, counter)
}

/* ---------- 1. 满分由科目决定 ---------- */
{
  const r = await freshStore()
  check('SUBJECTS 满分正确（数150/英100/政100/专150）',
    r.subjects.join(' ') === '数学:150 英语:100 政治:100 专业课:150', r.subjects.join(' '))
  check('subjectFull 逐科正确',
    r.mathFull === 150 && r.englishFull === 100 && r.politicsFull === 100 && r.majorFull === 150,
    `数${r.mathFull} 英${r.englishFull} 政${r.politicsFull} 专${r.majorFull}`)
  check('数学一总分满分 500', r.total500 === 500, String(r.total500))
  check('不考数学总分满分 350', r.total350 === 350, String(r.total350))
}

/* ---------- 2. setGoal 不传 full 也必须写对（这是原来的 bug） ---------- */
{
  const r = await freshStore()
  check('setGoal 不传 full 时，英语满分仍是 100（原 bug）',
    r.afterSet.includes('english:100/70'), r.afterSet.join(' '))
  check('setGoal 不传 full 时，数学满分是 150',
    r.afterSet.includes('math:150/120'), r.afterSet.join(' '))
}

/* ---------- 3. 目标分不得超出满分 ---------- */
{
  const r = await page.evaluate(async () => {
    const m = await import('/src/lib/store.js?cap=1')
    m.setGoal({ subject: 'english', target: 999, current: 999 })
    const g = m.state.goals.find((x) => x.subject === 'english')
    return { target: g.target, current: g.current, full: g.full }
  })
  check('英语目标分被压到 100 上限', r.target === 100, `target=${r.target}`)
  check('英语估分被压到 100 上限', r.current === 100, `current=${r.current}`)
}

/* ---------- 4. 老数据自动校正 ---------- */
{
  const r = await page.evaluate(async ([k, v]) => {
    localStorage.setItem(k, v)
    const m = await import('/src/lib/store.js?repair=1')
    const before = m.state.goals.map((g) => `${g.subject}:${g.full}`)
    const fixedCount = m.repairGoalFullMarks()
    const after = m.state.goals.map((g) => `${g.subject}:${g.full}/${g.target}`)
    return { before, fixedCount, after, summary: m.goalSummary() }
  }, [KEY, JSON.stringify(brokenState)])
  check('读入老数据后能检出满分错误', r.before.join(' ') === 'math:150 english:150 politics:150 major:150', r.before.join(' '))
  check('repairGoalFullMarks 修正了错误项', r.fixedCount >= 2, `修正 ${r.fixedCount} 处`)
  check('修正后英语满分 100', r.after.includes('english:100/100'), r.after.join(' '))
  check('修正后政治满分 100', r.after.includes('politics:100/70'), r.after.join(' '))
  check('goalSummary 满分合计 500', r.summary.full === 500, String(r.summary.full))
  check('goalSummary 目标分不超合计上限', r.summary.target <= 500, String(r.summary.target))
}

/* ---------- 5. 三套数学科目都能算满分 ---------- */
{
  const r = await page.evaluate(async () => {
    const m = await import('/src/lib/store.js?sets=1')
    return ['math1', 'math2', 'math3', 'no-math'].map((s) => `${s}=${m.totalFull(s)}`)
  })
  check('四套科目组合的总分满分',
    r.join(' ') === 'math1=500 math2=500 math3=500 no-math=350', r.join(' '))
}

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log('\n================ 结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))
  process.exitCode = 1
}
