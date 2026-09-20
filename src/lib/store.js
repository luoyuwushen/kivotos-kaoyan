/**
 * 数据层：单一的 state 对象 + localStorage 持久化 + 订阅通知。
 * 所有写操作都走这里，方便「改完立刻存、存完通知界面重绘」。
 */

import { uid, toDateKey, startOfDay, addDays, daysBetween, clamp } from './utils.js'

export const STORAGE_KEY = 'kivotos-kaoyan-v1'
export const DATA_VERSION = 1

/** 28考研初试：2027 年 12 月 26 日（12 月第 4 个周末的周日，可在设置里改） */
export const DEFAULT_EXAM_DATE = '2027-12-26'

/** 四大科目。color 用 CSS 变量名，不写死颜色值 */
export const SUBJECTS = [
  { id: 'math', name: '数学', short: '数', color: 'var(--accent)', tone: 'math' },
  { id: 'english', name: '英语', short: '英', color: 'var(--arona)', tone: 'english' },
  { id: 'politics', name: '政治', short: '政', color: 'var(--hoshino)', tone: 'politics' },
  { id: 'major', name: '专业课', short: '专', color: 'var(--plana)', tone: 'major' }
]

export function subjectById(id) {
  return SUBJECTS.find((s) => s.id === id) || SUBJECTS[0]
}

export function subjectName(id) {
  return subjectById(id).name
}

/** 四个备考阶段的时间比例（相对"今天 → 考试"的总天数） */
export const PHASE_TEMPLATE = [
  { id: 'base', name: '基础期', ratio: 0.42, goal: '把教材过一遍，建立知识框架', color: 'var(--accent)' },
  { id: 'build', name: '强化期', ratio: 0.3, goal: '刷题 + 归纳题型，把框架变成手感', color: 'var(--arona)' },
  { id: 'sprint', name: '冲刺期', ratio: 0.2, goal: '真题成套训练，查漏补缺', color: 'var(--hoshino)' },
  { id: 'mock', name: '模考期', ratio: 0.08, goal: '模拟考场节奏，稳住心态与作息', color: 'var(--plana)' }
]

function defaultState() {
  return {
    version: DATA_VERSION,
    profile: {
      nickname: 'Sensei',
      siteName: '基沃托斯作战本部',
      targetSchool: '',
      targetMajor: '',
      examDate: DEFAULT_EXAM_DATE,
      subjectSet: 'math1', // math1 数一 / math2 数二 / math3 数三 / no-math 不考数学
      dailyGoalMin: 360
    },
    quests: [],
    phases: [],
    chapters: [],
    focus: [],
    mistakes: [],
    goals: [],
    scores: [],
    progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 },
    medals: { unlocked: {} },
    settings: {
      theme: 'light',
      mascots: { hoshino: true, arona: true, plana: true, speech: true },
      aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false },
      sync: { gistToken: '', gistId: '' }
    },
    // 首次使用引导是否已完成
    onboarded: false
  }
}

/** 深合并：用默认值补齐老数据里缺失的字段（版本升级时不丢数据） */
function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(target) ? target : defaults
  if (defaults && typeof defaults === 'object') {
    const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {}
    for (const [key, value] of Object.entries(defaults)) {
      out[key] = mergeDefaults(out[key], value)
    }
    return out
  }
  return target === undefined || target === null ? defaults : target
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    return mergeDefaults(parsed, defaultState())
  } catch (err) {
    console.warn('[store] 读取本地数据失败，已回退到默认数据', err)
    return defaultState()
  }
}

export const state = load()

/* ---------------- 持久化 + 订阅 ---------------- */

const listeners = new Set()
let saveTimer = null

/** 数据变更后调用：合并写入 + 通知界面 */
export function commit(reason = 'update') {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (err) {
      console.error('[store] 保存失败（可能是浏览器隐私模式或空间不足）', err)
    }
  }, 120)
  for (const fn of listeners) {
    try {
      fn(state, reason)
    } catch (err) {
      console.error('[store] 订阅回调出错', err)
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetAll() {
  const fresh = defaultState()
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, fresh)
  commit('reset')
}

export function exportJSON() {
  return JSON.stringify(state, null, 2)
}

/** 导入：与默认结构合并，返回是否成功 */
export function importJSON(text) {
  const parsed = JSON.parse(text)
  const merged = mergeDefaults(parsed, defaultState())
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, merged)
  commit('import')
  return true
}

/* ---------------- 委托单（每日任务） ---------------- */

export function todayKey() {
  return toDateKey(new Date())
}

export function addQuest({ title, subject = 'math', date = todayKey(), estMin = 0, source = 'manual', chapterId = null }) {
  if (!String(title).trim()) return null
  const quest = {
    id: uid('q'),
    date,
    title: String(title).trim(),
    subject,
    estMin: Number(estMin) || 0,
    done: false,
    doneAt: '',
    source,
    chapterId,
    createdAt: Date.now()
  }
  state.quests.push(quest)
  commit('quest:add')
  return quest
}

export function updateQuest(id, patch) {
  const quest = state.quests.find((q) => q.id === id)
  if (!quest) return null
  Object.assign(quest, patch)
  commit('quest:update')
  return quest
}

export function toggleQuest(id, force) {
  const quest = state.quests.find((q) => q.id === id)
  if (!quest) return null
  quest.done = force === undefined ? !quest.done : Boolean(force)
  quest.doneAt = quest.done ? new Date().toISOString() : ''
  if (quest.chapterId) {
    const chapter = state.chapters.find((c) => c.id === quest.chapterId)
    if (chapter) {
      const siblings = state.quests.filter((q) => q.chapterId === quest.chapterId)
      chapter.done = siblings.length > 0 && siblings.every((q) => q.done)
    }
  }
  commit('quest:toggle')
  return quest
}

export function removeQuest(id) {
  const index = state.quests.findIndex((q) => q.id === id)
  if (index === -1) return false
  state.quests.splice(index, 1)
  commit('quest:remove')
  return true
}

export function questsOn(dateKey) {
  return state.quests
    .filter((q) => q.date === dateKey)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt)
}

/** 逾期未完成的任务总数（用于首页提醒） */
export function overdueCount() {
  const today = todayKey()
  return state.quests.filter((q) => !q.done && q.date < today).length
}

/** 把某天之前所有没做完的委托顺延到今天。返回移动的条数 */
export function rolloverOverdue(toDate = todayKey()) {
  const moved = state.quests.filter((q) => !q.done && q.date < toDate)
  for (const q of moved) q.date = toDate
  if (moved.length) commit('quest:rollover')
  return moved.length
}

/** 连续打卡天数：从最近有完成记录的日期往回数 */
export function computeStreak() {
  const doneDays = new Set(state.quests.filter((q) => q.done).map((q) => q.date))
  for (const f of state.focus) if (f.minutes > 0) doneDays.add(toDateKey(new Date(f.start)))
  let streak = 0
  let cursor = startOfDay(new Date())
  // 今天还没学不打断连续（还没到晚上），从昨天开始数
  if (!doneDays.has(toDateKey(cursor))) cursor = addDays(cursor, -1)
  while (doneDays.has(toDateKey(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

/* ---------------- 专注记录 ---------------- */

export function addFocus({ minutes, mode = 'pomodoro', subject = 'math', questId = null, startedAt = Date.now() }) {
  const entry = {
    id: uid('f'),
    start: startedAt,
    end: startedAt + minutes * 60000,
    minutes: Math.max(1, Math.round(minutes)),
    mode,
    subject,
    questId
  }
  state.focus.push(entry)
  state.progress.exp += Math.round(entry.minutes / 2)
  refreshLevel()
  commit('focus:add')
  return entry
}

export function focusMinutesOn(dateKey) {
  return state.focus
    .filter((f) => toDateKey(new Date(f.start)) === dateKey)
    .reduce((sum, f) => sum + f.minutes, 0)
}

/** 近 n 天每天的专注分钟数，用于热力图 */
export function focusHeatmap(days = 182, endDate = new Date()) {
  const map = new Map()
  for (const f of state.focus) {
    const key = toDateKey(new Date(f.start))
    map.set(key, (map.get(key) || 0) + f.minutes)
  }
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const key = toDateKey(addDays(endDate, -i))
    out.push({ date: key, minutes: map.get(key) || 0 })
  }
  return out
}

export function totalFocusMinutes() {
  return state.focus.reduce((sum, f) => sum + f.minutes, 0)
}

/** 某天各科专注时长，按分钟倒序 */
export function focusBySubject(dateKey = null) {
  const buckets = new Map()
  for (const entry of state.focus) {
    if (dateKey && toDateKey(new Date(entry.start)) !== dateKey) continue
    buckets.set(entry.subject, (buckets.get(entry.subject) || 0) + entry.minutes)
  }
  return [...buckets.entries()]
    .map(([subject, minutes]) => ({ subject, name: subjectName(subject), minutes }))
    .sort((a, b) => b.minutes - a.minutes)
}

/* ---------------- 阶段计划 ---------------- */

/** 按剩余天数重新排四个阶段（保留已完成阶段的名字与目标） */
export function generatePhases(fromDate = new Date(), examDate = state.profile.examDate) {
  const total = Math.max(daysBetween(fromDate, examDate), 4)
  let cursor = startOfDay(fromDate)
  const phases = []
  PHASE_TEMPLATE.forEach((tpl, i) => {
    const isLast = i === PHASE_TEMPLATE.length - 1
    const span = isLast ? Math.max(daysBetween(cursor, examDate), 1) : Math.max(Math.round(total * tpl.ratio), 1)
    const start = cursor
    const end = isLast ? startOfDay(examDate) : addDays(start, Math.max(span - 1, 0))
    phases.push({
      id: tpl.id,
      name: tpl.name,
      start: toDateKey(start),
      end: toDateKey(end),
      goal: tpl.goal,
      color: tpl.color,
      days: Math.max(daysBetween(start, end) + 1, 1)
    })
    cursor = addDays(end, 1)
  })
  state.phases = phases
  commit('phases:generate')
  return phases
}

/** 今天处于哪个阶段 */
export function currentPhase(now = new Date()) {
  const key = toDateKey(now)
  if (!state.phases.length) return null
  return (
    state.phases.find((p) => key >= p.start && key <= p.end) ||
    (key < state.phases[0].start ? state.phases[0] : state.phases[state.phases.length - 1])
  )
}

export function phaseProgress(phase, now = new Date()) {
  if (!phase) return { percent: 0, done: 0, left: 0 }
  const total = Math.max(daysBetween(phase.start, phase.end) + 1, 1)
  const passed = clamp(daysBetween(phase.start, now) + 1, 0, total)
  return { percent: Math.round((passed / total) * 100), done: passed, left: total - passed, total }
}

/* ---------------- 教材章节 ---------------- */

export function addChapter({ subject, book = '未命名教材', title, hours = 2, order = 0 }) {
  const chapter = {
    id: uid('c'),
    subject,
    book,
    title: String(title).trim(),
    hours: Number(hours) || 2,
    done: false,
    order,
    createdAt: Date.now()
  }
  state.chapters.push(chapter)
  commit('chapter:add')
  return chapter
}

export function removeChapter(id) {
  const i = state.chapters.findIndex((c) => c.id === id)
  if (i === -1) return false
  state.chapters.splice(i, 1)
  state.quests = state.quests.filter((q) => q.chapterId !== id)
  commit('chapter:remove')
  return true
}

/** 手动勾选章节完成：同步把它的委托一起标记 */
export function setChapterDone(id, done) {
  const chapter = state.chapters.find((c) => c.id === id)
  if (!chapter) return null
  chapter.done = Boolean(done)
  for (const quest of state.quests) {
    if (quest.chapterId !== id) continue
    quest.done = chapter.done
    quest.doneAt = chapter.done ? new Date().toISOString() : ''
  }
  commit('chapter:done')
  return chapter
}

/** 按「剩余天数均摊」把章节排成每天的委托 */
export function scheduleChapters({ subject, book, chapters, startDate = todayKey(), examDate = state.profile.examDate }) {
  const available = Math.max(daysBetween(startDate, examDate), 1)
  const totalHours = chapters.reduce((s, c) => s + (Number(c.hours) || 0), 0) || chapters.length
  // 每天最多安排 2 个章节，避免一天堆 10 条委托
  const perDay = Math.max(Math.ceil(chapters.length / available), 1)
  const created = []
  chapters.forEach((ch, i) => {
    const dayOffset = Math.floor(i / perDay)
    const date = toDateKey(addDays(startDate, Math.min(dayOffset, available - 1)))
    const chapter =
      addChapter({ subject, book, title: ch.title, hours: ch.hours, order: i }) || null
    if (!chapter) return
    const quest = addQuest({
      title: `${book} · ${ch.title}`,
      subject,
      date,
      estMin: Math.round((Number(ch.hours) || 0) * 60),
      source: 'chapter',
      chapterId: chapter.id
    })
    if (quest) created.push(quest)
  })
  return { created: created.length, totalHours, available }
}

/* ---------------- 错题本 ---------------- */

export function addMistake({ subject, topic, note = '', level = 'weak' }) {
  if (!String(topic).trim()) return null
  const item = {
    id: uid('m'),
    subject,
    topic: String(topic).trim(),
    note: String(note).trim(),
    level, // weak 生疏 / ok 一般 / solid 熟练
    rounds: 0,
    createdAt: Date.now(),
    lastReview: '',
    nextReview: toDateKey(addDays(new Date(), 1))
  }
  state.mistakes.push(item)
  commit('mistake:add')
  return item
}

const REVIEW_INTERVALS = { weak: 1, ok: 3, solid: 7 }

/** 复习一轮：熟练度升级，下次复习时间按间隔推后 */
export function reviewMistake(id) {
  const item = state.mistakes.find((m) => m.id === id)
  if (!item) return null
  const ladder = ['weak', 'ok', 'solid']
  const nextIndex = Math.min(ladder.indexOf(item.level) + 1, ladder.length - 1)
  item.level = ladder[nextIndex]
  item.rounds += 1
  item.lastReview = toDateKey(new Date())
  item.nextReview = toDateKey(addDays(new Date(), REVIEW_INTERVALS[item.level]))
  commit('mistake:review')
  return item
}

export function removeMistake(id) {
  const i = state.mistakes.findIndex((m) => m.id === id)
  if (i === -1) return false
  state.mistakes.splice(i, 1)
  commit('mistake:remove')
  return true
}

/** 编辑条目：改了熟练度就顺手重排下次复习时间 */
export function updateMistake(id, patch) {
  const item = state.mistakes.find((m) => m.id === id)
  if (!item) return null
  const levelChanged = patch.level && patch.level !== item.level
  Object.assign(item, patch)
  if (typeof item.topic === 'string') item.topic = item.topic.trim() || item.topic
  if (levelChanged) item.nextReview = toDateKey(addDays(new Date(), REVIEW_INTERVALS[item.level] || 1))
  commit('mistake:update')
  return item
}

export function dueMistakes(now = new Date()) {
  const key = toDateKey(now)
  return state.mistakes.filter((m) => !m.nextReview || m.nextReview <= key)
}

/* ---------------- 目标看板 ---------------- */

export function setGoal({ subject, target, current = 0, full = 150 }) {
  let goal = state.goals.find((g) => g.subject === subject)
  if (!goal) {
    goal = { subject, target: 0, current: 0, full: 150 }
    state.goals.push(goal)
  }
  Object.assign(goal, {
    target: Number(target) || 0,
    current: Number(current) || 0,
    full: Number(full) || 150
  })
  commit('goal:set')
  return goal
}

export function addScoreLine({ year, school, major = '', total, lines = {}, note = '' }) {
  const item = { id: uid('s'), year: Number(year), school, major, total: Number(total) || 0, lines, note }
  state.scores.push(item)
  commit('score:add')
  return item
}

export function removeScoreLine(id) {
  const i = state.scores.findIndex((s) => s.id === id)
  if (i === -1) return false
  state.scores.splice(i, 1)
  commit('score:remove')
  return true
}

export function goalSummary() {
  const target = state.goals.reduce((s, g) => s + g.target, 0)
  const current = state.goals.reduce((s, g) => s + g.current, 0)
  const full = state.goals.reduce((s, g) => s + g.full, 0)
  return { target, current, full, gap: Math.max(target - current, 0) }
}

/* ---------------- 等级 ---------------- */

export function levelFromExp(exp) {
  let level = 1
  let need = 100
  let rest = Math.max(0, Math.round(exp))
  while (rest >= need && level < 99) {
    rest -= need
    level += 1
    need = Math.round(need * 1.18)
  }
  return { level, into: rest, need }
}

export function refreshLevel() {
  const { level } = levelFromExp(state.progress.exp)
  state.progress.level = level
  return level
}

export function checkIn() {
  const today = todayKey()
  const { progress } = state
  if (progress.lastCheckIn === today) return { streak: progress.streak, isNew: false }
  const yesterday = toDateKey(addDays(new Date(), -1))
  progress.streak = progress.lastCheckIn === yesterday ? progress.streak + 1 : 1
  progress.lastCheckIn = today
  progress.bestStreak = Math.max(progress.bestStreak, progress.streak)
  progress.exp += 20
  refreshLevel()
  commit('checkin')
  return { streak: progress.streak, isNew: true }
}

/* ---------------- 设置 ---------------- */

export function updateProfile(patch) {
  Object.assign(state.profile, patch)
  commit('profile:update')
}

export function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      state.settings[key] = { ...state.settings[key], ...value }
    } else {
      state.settings[key] = value
    }
  }
  commit('settings:update')
}

/** 一次性统计，首页与勋章墙共用 */
export function stats(now = new Date()) {
  const doneQuests = state.quests.filter((q) => q.done)
  return {
    totalQuests: state.quests.length,
    doneQuests: doneQuests.length,
    totalFocus: totalFocusMinutes(),
    focusDays: new Set(state.focus.map((f) => toDateKey(new Date(f.start)))).size,
    chapters: state.chapters.length,
    chaptersDone: state.chapters.filter((c) => c.done).length,
    mistakes: state.mistakes.length,
    mistakesSolid: state.mistakes.filter((m) => m.level === 'solid').length,
    streak: computeStreak(),
    todayMinutes: focusMinutesOn(todayKey()),
    todayQuests: questsOn(todayKey())
  }
}
