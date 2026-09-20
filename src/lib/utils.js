/**
 * 通用工具：日期、格式化、DOM 构建、事件。
 * 保持无依赖，全部是纯函数，方便在其他地方复用。
 */

/* ---------------- 日期 ---------------- */

export const DAY_MS = 86400000

/** 把任意输入解析成「当地时间的当天 0 点」 */
export function startOfDay(input = new Date()) {
  const d = input instanceof Date ? new Date(input) : parseDate(input)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 'YYYY-MM-DD' → Date（按当地时间，避免 UTC 偏移把日期挪一天） */
export function parseDate(str) {
  if (str instanceof Date) return new Date(str)
  if (typeof str !== 'string') return new Date(NaN)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str.trim())
  if (!m) return new Date(str)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Date → 'YYYY-MM-DD' */
export function toDateKey(input = new Date()) {
  const d = input instanceof Date ? input : parseDate(input)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 两个日期之间相差的整天数（b - a） */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
}

/** 在日期上加 n 天 */
export function addDays(input, n) {
  const d = startOfDay(input)
  d.setDate(d.getDate() + n)
  return d
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function weekdayCN(input) {
  return WEEKDAYS[parseDate(input).getDay()]
}

/** '2026-09-20' → '9月20日 周日' */
export function formatDateCN(input, withWeekday = true) {
  const d = parseDate(input)
  if (Number.isNaN(d.getTime())) return '—'
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return withWeekday ? `${base} ${WEEKDAYS[d.getDay()]}` : base
}

/** 相对今天的说法：今天 / 明天 / 昨天 / 3 天后 */
export function relativeDayLabel(dateKey, today = new Date()) {
  const diff = daysBetween(today, dateKey)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff === 2) return '后天'
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`
}

/**
 * 距离考试还剩多少。考前返回正数，考完返回负数。
 * 用「当天 0 点」相减，保证同一天内数字稳定不跳。
 */
export function examCountdown(examDate, now = new Date()) {
  const today = startOfDay(now)
  const exam = startOfDay(examDate)
  const totalDays = daysBetween(today, exam)
  return {
    days: Math.max(totalDays, 0),
    rawDays: totalDays,
    isPast: totalDays < 0,
    weeks: Math.max(Math.floor(totalDays / 7), 0),
    remainWeeksText: totalDays >= 0 ? `${Math.floor(totalDays / 7)} 周 ${totalDays % 7} 天` : '已结束'
  }
}

/** 分钟 → '2小时30分' */
export function formatMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0))
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

/** 秒 → '25:00' */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/* ---------------- DOM ---------------- */

/**
 * 极简 DOM 构建器。
 *   el('div', { class: 'card' }, ['文字', el('b', {}, '粗体')])
 * 支持：class / id / style 对象 / dataset / on* 事件 / html / 其余作为属性。
 */
export function el(tag, props = null, children = null) {
  const node = document.createElement(tag)
  applyProps(node, props)
  appendChildren(node, children)
  return node
}

/** SVG 版本：必须用 createElementNS */
export function svg(tag, props = null, children = null) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  applyProps(node, props)
  appendChildren(node, children)
  return node
}

function applyProps(node, props) {
  if (!props) return
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class' || key === 'className') {
      node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value))
    } else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue
        if (k.startsWith('--')) node.style.setProperty(k, String(v))
        else node.style[k] = v
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue
        node.dataset[k] = String(v)
      }
    } else if (key === 'html') {
      node.innerHTML = String(value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === 'value' && 'value' in node) {
      node.value = value
    } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') {
      if (value) node.setAttribute(key, '')
      node[key] = Boolean(value)
    } else {
      node.setAttribute(key, String(value))
    }
  }
}

function appendChildren(node, children) {
  if (children === null || children === undefined || children === false) return
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
  return node
}

export function mount(parent, ...nodes) {
  clear(parent)
  for (const n of nodes) if (n) parent.append(n)
  return parent
}

/** 事件委托：容器上挂一个监听，按 selector 分发 */
export function delegate(root, eventName, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector)
    if (target && root.contains(target)) handler(event, target)
  }
  root.addEventListener(eventName, listener)
  return () => root.removeEventListener(eventName, listener)
}

/* ---------------- 杂项 ---------------- */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c])
}

/** 按天做种子的伪随机，保证「同一天抽到同一句台词」 */
export function seededIndex(seedStr, length) {
  if (length <= 0) return 0
  let hash = 2166136261
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % length
}

export function debounce(fn, wait = 240) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

/** 把秒数拆成 天/时/分/秒，用于倒计时展示 */
export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}
