/**
 * 线上站点验证：种入确定的数据 → 检查渲染 → 截图。
 * 与 smoke.mjs 的区别：用 goto('about:blank') 强制落地，避免同 URL reload 被跳过。
 *
 *   node scripts/verify-live.mjs
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.TARGET || 'https://luoyuwushen.github.io/kivotos-kaoyan/'
const OUT = process.env.OUT || 'live-verify'
const KEY = 'kivotos-kaoyan-v1'

const seed = {
  version: 1,
  profile: {
    nickname: 'Sensei', siteName: '基沃托斯作战本部',
    targetSchool: '某某大学', targetMajor: '计算机科学与技术',
    examDate: '2027-12-26', subjectSet: 'math1', dailyGoalMin: 360
  },
  quests: [
    { id: 'q1', date: '2026-09-20', title: '高数 第三章 中值定理 + 课后题', subject: 'math', estMin: 120, done: true, doneAt: '', source: 'manual', chapterId: null, createdAt: 1 },
    { id: 'q2', date: '2026-09-20', title: '考研词汇 Unit 12', subject: 'english', estMin: 45, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 2 },
    { id: 'q3', date: '2026-09-20', title: '政治 马原 第二章', subject: 'politics', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 3 },
    { id: 'q4', date: '2026-09-20', title: '专业课 第二章', subject: 'major', estMin: 90, done: false, doneAt: '', source: 'chapter', chapterId: 'c2', createdAt: 4 }
  ],
  phases: [
    { id: 'base', name: '基础期', start: '2026-09-21', end: '2027-04-02', goal: '把教材过一遍', color: 'var(--accent)' },
    { id: 'build', name: '强化期', start: '2027-04-03', end: '2027-08-18', goal: '刷题归纳', color: 'var(--arona)' },
    { id: 'sprint', name: '冲刺期', start: '2027-08-19', end: '2027-11-18', goal: '真题成套', color: 'var(--hoshino)' },
    { id: 'mock', name: '模考期', start: '2027-11-19', end: '2027-12-26', goal: '稳节奏', color: 'var(--plana)' }
  ],
  chapters: [
    { id: 'c1', subject: 'major', book: '参考书一', title: '第一章 绪论', hours: 8, done: true, order: 0, createdAt: 1 },
    { id: 'c2', subject: 'major', book: '参考书一', title: '第二章 基础理论', hours: 8, done: false, order: 1, createdAt: 2 }
  ],
  focus: [
    { id: 'f1', start: Date.now() - 3600000, end: Date.now(), minutes: 60, mode: 'pomodoro', subject: 'math', questId: null }
  ],
  mistakes: [
    { id: 'm1', subject: 'math', topic: '中值定理辅助函数构造', note: '先想罗尔', level: 'weak', rounds: 1, createdAt: 1, lastReview: '', nextReview: '2026-09-20' }
  ],
  goals: [
    { subject: 'math', target: 120, current: 96, full: 150 },
    { subject: 'english', target: 70, current: 61, full: 100 },
    { subject: 'politics', target: 70, current: 58, full: 100 },
    { subject: 'major', target: 120, current: 88, full: 150 }
  ],
  scores: [],
  progress: { streak: 12, bestStreak: 21, lastCheckIn: '2026-09-19', exp: 2480, level: 1 },
  medals: { unlocked: { first_quest: new Date().toISOString() } },
  settings: {
    theme: 'light',
    mascots: { hoshino: true, arona: true, plana: true, speech: true },
    customCharacters: false,
    aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false },
    sync: { gistToken: '', gistId: '' }
  },
  onboarded: true
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const problems = []

async function shot(name, { width, height, view }) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, locale: 'zh-CN'
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[pageerror:${name}] ${e.message}`))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(t)) {
      problems.push(`[console:${name}] ${t}`)
    }
  })
  page.on('response', (res) => {
    if (res.status() === 404) problems.push(`[404:${name}] ${res.url()}`)
  })
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

  // 关键：必须用 addInitScript 在**页面任何脚本执行之前**把数据写进 localStorage。
  // 用 goto / reload 都不可靠——应用模块可能在写入前就已经读取了空状态，
  // 导致欢迎引导被触发并把 onboarded 覆盖回 false。
  await context.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v) } catch {}
  }, [KEY, JSON.stringify(seed)])

  await page.goto(`${BASE}#${view}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  const info = await page.evaluate(() => ({
    modal: document.querySelectorAll('.modal-backdrop').length,
    appLen: document.getElementById('app')?.innerHTML?.length || 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }))
  if (info.modal) problems.push(`[modal:${name}] 不该出现的弹窗`)
  if (info.appLen < 3000) problems.push(`[render:${name}] 页面内容过少（${info.appLen} 字符）`)
  if (info.overflow > 2) problems.push(`[overflow:${name}] 横向溢出 ${info.overflow}px`)

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  await context.close()
}

for (const view of ['home', 'quests', 'plan', 'focus', 'mistakes', 'goals', 'medals', 'settings']) {
  await shot(`desktop-${view}`, { width: 1440, height: 1000, view })
}
for (const view of ['home', 'goals', 'focus']) {
  await shot(`mobile-${view}`, { width: 390, height: 844, view })
}
await shot('tablet-home', { width: 834, height: 1112, view: 'home' })

await browser.close()

console.log(`\n=== 线上验证完成，截图在 ${OUT} ===`)
if (problems.length) {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const p of [...new Set(problems)]) console.log(' - ' + p)
  process.exitCode = 1
} else {
  console.log('全部通过：无控制台错误、无 404、无异常弹窗、无横向溢出。')
}
