/**
 * 交互基建：Toast 提示、Modal 弹窗、SpotlightCard 聚光、打字机、滚动 reveal。
 * 全部用原生 API，无第三方依赖。
 */

import { el, clear, svg } from '../lib/utils.js'
import { icon } from './icons.js'

export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canHover = window.matchMedia('(hover: hover)').matches

/* ---------------- Toast ---------------- */

let toastHost = null

function ensureToastHost() {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' })
    document.body.append(toastHost)
  }
  return toastHost
}

const TOAST_ICONS = {
  ok: 'check',
  medal: 'medal',
  info: 'spark',
  error: 'close'
}

export function toast(message, { kind = 'ok', ms = 2600, iconName } = {}) {
  const host = ensureToastHost()
  const node = el('div', { class: 'toast', dataset: { kind } }, [
    el('span', { class: 'toast__icon' }, icon(iconName || TOAST_ICONS[kind] || 'spark')),
    el('span', {}, message)
  ])
  host.append(node)
  const remove = () => {
    node.style.transition = 'opacity .25s ease, transform .25s ease'
    node.style.opacity = '0'
    node.style.transform = 'translateY(10px)'
    setTimeout(() => node.remove(), 260)
  }
  setTimeout(remove, ms)
  return remove
}

// 局部 import 避免循环依赖

/* ---------------- Modal ---------------- */

/**
 * openModal({ title, body, actions, width })
 * body 可以是节点或返回节点的函数；actions: [{ label, kind, onClick, close }]
 */
export function openModal({ title, body, actions = [], onClose = null, className = '' }) {
  const backdrop = el('div', { class: 'modal-backdrop' })
  const modal = el('div', {
    class: `modal ${className}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || '弹窗'
  })

  const close = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
    if (document.querySelector('.modal-backdrop') === null) document.body.style.overflow = ''
    onClose?.()
  }

  const onKey = (event) => {
    if (event.key === 'Escape') close()
    if (event.key === 'Tab') {
      const focusables = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  if (title) {
    modal.append(
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title' }, title),
        el(
          'button',
          { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': '关闭', onClick: close, style: { marginLeft: 'auto' } },
          icon('close')
        )
      ])
    )
  }

  const bodyWrap = el('div', { class: 'modal__body' })
  const content = typeof body === 'function' ? body({ close }) : body
  if (content) bodyWrap.append(content)
  modal.append(bodyWrap)

  if (actions.length) {
    const foot = el('div', { class: 'modal__foot' })
    for (const action of actions) {
      foot.append(
        el(
          'button',
          {
            class: `btn ${action.kind === 'primary' ? 'btn--primary' : action.kind === 'danger' ? 'btn--danger' : ''}`.trim(),
            type: 'button',
            onClick: () => {
              const result = action.onClick?.()
              if (action.close !== false && result !== false) close()
            }
          },
          action.label
        )
      )
    }
    modal.append(foot)
  }

  backdrop.append(modal)
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close()
  })
  document.body.append(backdrop)
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKey)
  requestAnimationFrame(() => {
    const target = modal.querySelector('input, textarea, select, button:not([aria-label="关闭"])')
    target?.focus()
  })
  return { close, modal }
}

export function confirmDialog({ title, message, confirmLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: el('p', { class: 'dim', style: { lineHeight: '1.75' } }, message),
      actions: [
        { label: '取消', onClick: () => resolve(false) },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) }
      ],
      onClose: () => resolve(false)
    })
  })
}

/* ---------------- SpotlightCard ---------------- */

/** 鼠标跟踪聚光：用 CSS 变量 + rAF 节流，成本极低 */
export function enableSpotlight(root) {
  if (!canHover || REDUCED) return () => {}
  let frame = 0
  let pending = null
  const onMove = (event) => {
    const card = event.target.closest?.('.card--spot')
    if (!card) return
    pending = { card, x: event.clientX, y: event.clientY }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!pending) return
      const rect = pending.card.getBoundingClientRect()
      pending.card.style.setProperty('--mx', `${pending.x - rect.left}px`)
      pending.card.style.setProperty('--my', `${pending.y - rect.top}px`)
      pending = null
    })
  }
  root.addEventListener('pointermove', onMove)
  return () => root.removeEventListener('pointermove', onMove)
}

/* ---------------- 滚动 / 切换 reveal ---------------- */

let observer = null

export function observeReveals(scope) {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('rise')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    )
  }
  scope.querySelectorAll('[data-reveal]:not(.rise)').forEach((node) => observer.observe(node))
}

/* ---------------- 打字机 ---------------- */

/**
 * 逐字显示。返回一个函数用于「跳过」（立刻显示全部）。
 * 减弱动效时直接给终值。
 */
export function typewriter(node, text, { speed = 34, onDone = null } = {}) {
  if (REDUCED) {
    node.textContent = text
    onDone?.()
    return () => {}
  }
  let index = 0
  let timer = null
  let done = false
  const caret = el('span', { class: 'speech__caret' })

  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    node.textContent = text
    caret.remove()
    onDone?.()
  }

  node.textContent = ''
  node.append(caret)
  const step = () => {
    if (index >= text.length) {
      finish()
      return
    }
    // 标点稍作停顿，读起来更像说话
    const ch = text[index]
    index += 1
    caret.before(document.createTextNode(ch))
    const pause = '，。！？…、；：'.includes(ch) ? speed * 5 : speed
    timer = setTimeout(step, pause)
  }
  timer = setTimeout(step, 120)

  return () => {
    if (!done) {
      clearTimeout(timer)
      finish()
    }
  }
}

/* ---------------- 数字滚动 ---------------- */

/** 数字变化时逐位做一次翻动；值没变就不动 */
export function digitsNode(value, prevDigits = []) {
  const str = String(value)
  const wrap = el('span', { class: 'countdown__digits' })
  const next = []
  for (let i = 0; i < str.length; i++) {
    const changed = prevDigits[i] !== str[i]
    const span = el(
      'span',
      { class: changed && !REDUCED ? 'countdown__digit' : '' },
      str[i]
    )
    wrap.append(span)
    next.push(str[i])
  }
  return { node: wrap, digits: next }
}

/* ---------------- 空状态 ---------------- */

export function emptyState(text, actionLabel, onAction) {
  const wrap = el('div', { class: 'empty' }, text)
  if (actionLabel && onAction) {
    wrap.append(
      el('div', { style: { marginTop: '0.75rem' } }, [
        el('button', { class: 'btn btn--sm', type: 'button', onClick: onAction }, actionLabel)
      ])
    )
  }
  return wrap
}

/** 进度条 */
export function progressBar(percent, { thin = false, label = '' } = {}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return el('div', { class: `progress${thin ? ' progress--thin' : ''}`, role: 'progressbar', 'aria-valuenow': clamped, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label || '进度', style: { flex: '1' } }, [
    el('div', { class: 'progress__fill', style: { width: `${clamped}%` } })
  ])
}

/** 三星等级点（错题掌握程度） */
export function levelDots(level) {
  const order = { weak: 1, ok: 2, solid: 3 }
  const on = order[level] || 1
  const wrap = el('span', { class: 'level-dots', 'aria-label': `掌握程度 ${on}/3` })
  for (let i = 1; i <= 3; i++) wrap.append(el('i', { dataset: { on: String(i <= on) } }))
  return wrap
}
