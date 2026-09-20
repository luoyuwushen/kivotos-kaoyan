/**
 * 番茄钟引擎。
 *
 * 关键设计：**以时间戳为准，不用 setInterval 累加**。
 * 这样即使切到别的页面、或者合上笔记本再打开，走过的时间照算，不会漂移。
 * 引擎是模块级单例，切视图不会中断计时。
 */

import { addFocus, state } from '../lib/store.js'
import { toast } from '../components/ui.js'

const PERSIST_KEY = 'kivotos-kaoyan-timer'

const MODES = {
  pomodoro: { label: '专注', minutes: 25, next: 'short' },
  short: { label: '短休息', minutes: 5, next: 'pomodoro' },
  long: { label: '长休息', minutes: 15, next: 'pomodoro' },
  countup: { label: '正计时', minutes: 0, next: null }
}

export const MODE_KEYS = Object.keys(MODES)

function defaults() {
  return {
    mode: 'pomodoro',
    duration: 25 * 60, // 秒
    remaining: 25 * 60,
    elapsed: 0,
    running: false,
    startedAt: 0, // 运行中：记录本轮起点（ms）
    carry: 0, // 暂停时已累计的秒数
    round: 0, // 完成的番茄数
    subject: state.quests[0]?.subject || 'math',
    questId: null,
    longEvery: 4
  }
}

function load() {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY)
    if (!raw) return defaults()
    return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    return defaults()
  }
}

export const timer = load()

const listeners = new Set()
let tickHandle = null

export function subscribeTimer(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  sessionStorage.setItem(PERSIST_KEY, JSON.stringify(timer))
  for (const fn of listeners) {
    try {
      fn(timer)
    } catch (err) {
      console.error('[timer] 订阅回调出错', err)
    }
  }
}

/** 当前已经走过的秒数（以时间戳计算，不受 tick 频率影响） */
export function liveElapsed() {
  if (!timer.running) return timer.carry
  return timer.carry + (Date.now() - timer.startedAt) / 1000
}

export function liveRemaining() {
  if (timer.mode === 'countup') return liveElapsed()
  return Math.max(timer.duration - liveElapsed(), 0)
}

export function progressRatio() {
  if (timer.mode === 'countup' || !timer.duration) return 0
  return Math.min(liveElapsed() / timer.duration, 1)
}

export function modeLabel() {
  return MODES[timer.mode]?.label || '专注'
}

export function isBreak() {
  return timer.mode === 'short' || timer.mode === 'long'
}

/* ---------------- 控制 ---------------- */

export function start() {
  if (timer.running) return
  timer.running = true
  timer.startedAt = Date.now()
  notify()
  ensureTick()
  requestNotifyPermission()
}

export function pause() {
  if (!timer.running) return
  timer.carry = liveElapsed()
  timer.running = false
  notify()
  stopTick()
}

export function reset() {
  timer.running = false
  timer.carry = 0
  timer.elapsed = 0
  timer.remaining = timer.mode === 'countup' ? 0 : timer.duration
  notify()
  stopTick()
}

export function setMode(mode, minutes) {
  if (!MODES[mode]) return
  timer.mode = mode
  const mins = minutes ?? MODES[mode].minutes
  timer.duration = mode === 'countup' ? 0 : Math.max(1, Math.round(mins * 60))
  timer.carry = 0
  timer.elapsed = 0
  timer.remaining = timer.duration
  timer.running = false
  notify()
  stopTick()
}

export function setDuration(minutes) {
  timer.duration = Math.max(1, Math.round(minutes * 60))
  timer.carry = 0
  timer.running = false
  timer.remaining = timer.duration
  notify()
  stopTick()
}

export function setSubject(subject) {
  timer.subject = subject
  notify()
}

export function setQuest(questId) {
  timer.questId = questId
  notify()
}

function stopTick() {
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

function ensureTick() {
  if (tickHandle) return
  tickHandle = setInterval(() => {
    if (!timer.running) {
      stopTick()
      return
    }
    const elapsed = liveElapsed()
    timer.elapsed = elapsed
    if (timer.mode !== 'countup') {
      timer.remaining = Math.max(timer.duration - elapsed, 0)
      if (timer.remaining <= 0) {
        complete()
        return
      }
    }
    notify()
  }, 500)
}

/* ---------------- 完成一段 ---------------- */

function complete() {
  stopTick()
  const minutes = timer.mode === 'countup' ? Math.round(timer.carry / 60) : Math.round(timer.duration / 60)
  const wasFocus = timer.mode === 'pomodoro' || timer.mode === 'countup'
  timer.running = false
  timer.carry = 0
  timer.elapsed = 0

  if (wasFocus && minutes >= 1) {
    addFocus({ minutes, mode: timer.mode, subject: timer.subject, questId: timer.questId })
    timer.round += 1
    toast(`专注 ${minutes} 分钟已记录`, { kind: 'ok', iconName: 'check' })
  } else if (!wasFocus) {
    toast('休息结束，准备下一轮', { kind: 'info', iconName: 'spark' })
  }

  // 自动切到下一段（不自动开始，避免突然计时）
  if (MODES[timer.mode].next) {
    const nextMode =
      timer.mode === 'pomodoro' && timer.round > 0 && timer.round % timer.longEvery === 0
        ? 'long'
        : MODES[timer.mode].next
    timer.mode = nextMode
    timer.duration = MODES[nextMode].minutes * 60
  } else {
    timer.mode = 'pomodoro'
    timer.duration = 25 * 60
  }
  timer.remaining = timer.duration
  notify()
  chime(wasFocus)
  notifyBrowser(wasFocus, minutes)
}

/* ---------------- 提示音（现场合成，不带音频文件） ---------------- */

let audioCtx = null

export function chime(isFocusEnd = true) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const now = audioCtx.currentTime
    // 专注结束：上行三音（完成感）；休息结束：两音（提醒）
    const notes = isFocusEnd ? [660, 880, 1320] : [880, 660]
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const at = now + i * 0.16
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(at)
      osc.stop(at + 0.5)
    })
  } catch (err) {
    console.warn('[timer] 提示音播放失败（浏览器可能拦截了自动播放）', err)
  }
}

/* ---------------- 浏览器通知 ---------------- */

export function requestNotifyPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}

function notifyBrowser(isFocusEnd, minutes) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible' && !isBreak()) {
    // 页面在前台时用 toast 就够，不重复打扰
    return
  }
  try {
    new Notification(isFocusEnd ? '这一段专注完成了' : '休息结束', {
      body: isFocusEnd ? `${minutes} 分钟已记录。起来走两步，喝口水。` : '准备好就开始下一段吧。',
      icon: undefined,
      tag: 'kivotos-timer'
    })
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 页面恢复对齐 ---------------- */

// 从后台切回来时立刻校正一次，避免显示停在旧值
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer.running) {
    ensureTick()
    notify()
  }
})

// 运行中刷新页面也能接着走（用时间戳续算）
if (timer.running && timer.startedAt) {
  const elapsed = liveElapsed()
  if (timer.mode !== 'countup' && elapsed >= timer.duration) {
    // 刷新期间就已经结束了，直接结算
    timer.carry = timer.duration
    complete()
  } else {
    ensureTick()
  }
}
