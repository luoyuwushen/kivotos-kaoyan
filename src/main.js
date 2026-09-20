/**
 * 应用入口：外壳、导航、路由、初始化与勋章结算。
 */

import './styles/main.css'

import { el, mount, toDateKey, examCountdown } from './lib/utils.js'
import { state, subscribe, commit, stats, overdueCount, dueMistakes, rolloverOverdue, generatePhases, updateProfile } from './lib/store.js'
import { icon, brandMark } from './components/icons.js'
import { toast, enableSpotlight, observeReveals, openModal, REDUCED } from './components/ui.js'
import { appFooter } from './components/footer.js'
import { buildSnapshot, findNewlyUnlocked } from './data/medals.js'

import { renderHome } from './views/home.js'
import { renderQuests } from './views/quests.js'
import { renderPlan } from './views/plan.js'
import { renderFocus } from './views/focus.js'
import { renderMistakes } from './views/mistakes.js'
import { renderGoals } from './views/goals.js'
import { renderMedals } from './views/medals.js'
import { renderSettings, applyTheme } from './views/settings.js'

/* ---------------- 导航定义 ---------------- */

const NAV = [
  { id: 'home', label: '作战本部', icon: 'home', render: renderHome },
  { id: 'quests', label: '每日委托', icon: 'quest', render: renderQuests, badge: () => overdueCount() },
  { id: 'plan', label: '阶段计划', icon: 'plan', render: renderPlan },
  { id: 'focus', label: '专注计时', icon: 'timer', render: renderFocus },
  { id: 'mistakes', label: '错题本', icon: 'book', render: renderMistakes, badge: () => dueMistakes().length },
  { id: 'goals', label: '目标看板', icon: 'target', render: renderGoals },
  { id: 'medals', label: '勋章墙', icon: 'medal', render: renderMedals },
  { id: 'settings', label: '设置', icon: 'settings', render: renderSettings }
]

const app = document.getElementById('app')
let currentView = 'home'
let viewDestroyers = []
let rerenderScheduled = false

/* ---------------- 渲染上下文 ---------------- */

function makeCtx() {
  return {
    go(view) {
      if (location.hash.slice(1) === view) return
      location.hash = view
    },
    refresh() {
      scheduleRender()
    },
    onDestroy(fn) {
      viewDestroyers.push(fn)
    }
  }
}

/* ---------------- 背景氛围 ---------------- */

/**
 * 天空层。视觉基准是官方站那片天：天色渐变 + 斜射光柱 + 页脚云带 + 细网格。
 * 全部是纯 CSS 图形，不含任何取自官方站的图片或纹理。
 */
function buildBackground() {
  const layer = el('div', { class: 'bg-layer', 'aria-hidden': 'true' })

  layer.append(
    el('div', { class: 'bg-sky' }),
    el('div', { class: 'bg-bloom bg-bloom--sun' }),
    el('div', { class: 'bg-bloom bg-bloom--far' })
  )

  // 光柱：由左上斜射下来，只呼吸 opacity（零 blur、零重排）
  const raySpots = [
    { left: '8%', cls: 'bg-ray' },
    { left: '38%', cls: 'bg-ray bg-ray--2' },
    { left: '72%', cls: 'bg-ray bg-ray--3' }
  ]
  for (const ray of raySpots) {
    layer.append(el('div', { class: ray.cls, style: { left: ray.left } }))
  }

  layer.append(el('div', { class: 'bg-hatch' }), el('div', { class: 'bg-cloud' }))

  const COUNT = 14
  for (let i = 0; i < COUNT; i++) {
    const size = 5 + ((i * 37) % 22)
    layer.append(
      el('div', {
        class: 'bg-layer__spark',
        style: {
          width: `${size}px`,
          height: `${size}px`,
          left: `${(i * 67) % 100}%`,
          top: `${(i * 41) % 100}%`,
          animationDuration: `${7 + ((i * 13) % 9)}s`,
          animationDelay: `${(i % 7) * 0.9}s`,
          background: i % 5 === 0 ? 'var(--hoshino)' : i % 3 === 0 ? 'var(--arona)' : 'var(--accent)'
        }
      })
    )
  }
  return layer
}

/* ---------------- 外壳 ---------------- */

function buildShell() {
  const sidenav = el('nav', { class: 'sidenav', 'aria-label': '主导航' })

  const brandTitle = el('div', { class: 'brand__title' }, state.profile.siteName || '基沃托斯作战本部')
  const brandSub = el('div', { class: 'brand__sub' }, `28考研 · ${state.profile.nickname || 'Sensei'}`)

  sidenav.append(
    el('div', { class: 'brand' }, [
      brandMark(34),
      el('div', { class: 'brand__text' }, [brandTitle, brandSub])
    ])
  )

  const tabbar = el('div', { class: 'tabbar' })
  for (const item of NAV) {
    tabbar.append(
      el(
        'button',
        {
          class: 'nav-item',
          type: 'button',
          dataset: { view: item.id },
          'aria-label': item.label,
          onClick: () => {
            location.hash = item.id
          }
        },
        [icon(item.icon, { size: 20, className: 'nav-item__icon' }), el('span', {}, item.label)]
      )
    )
  }
  sidenav.append(tabbar)

  const main = el('main', { class: 'main', id: 'main', tabindex: '-1' })
  const shell = el('div', { class: 'shell' }, [sidenav, main])
  const shellWrap = el('div', { class: 'app' }, [shell, appFooter()])

  mount(app, buildBackground(), shellWrap)

  // 品牌区在启动时只建一次，所以要单独跟着数据更新，
  // 否则改了「称呼 / 站点名称」侧栏不会变。
  const syncBrand = () => {
    brandTitle.textContent = state.profile.siteName || '基沃托斯作战本部'
    brandSub.textContent = `28考研 · ${state.profile.nickname || 'Sensei'}`
  }
  subscribe(syncBrand)

  return { main, sidenav }
}

let mainNode = null

/* ---------------- 路由 ---------------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0]
  return NAV.some((n) => n.id === raw) ? raw : 'home'
}

function scheduleRender() {
  if (rerenderScheduled) return
  rerenderScheduled = true
  requestAnimationFrame(() => {
    rerenderScheduled = false
    render()
  })
}

function render() {
  currentView = parseHash()
  const entry = NAV.find((n) => n.id === currentView) || NAV[0]

  // 清理上一个视图的定时器 / 订阅
  for (const destroy of viewDestroyers) {
    try {
      destroy()
    } catch (err) {
      console.error('[app] 视图清理出错', err)
    }
  }
  viewDestroyers = []

  const ctx = makeCtx()
  const view = entry.render(ctx)

  mount(mainNode, view)
  updateNav()
  observeReveals(mainNode)
  checkMedals()
  document.title = `${entry.label} · ${state.profile.siteName || '基沃托斯作战本部'}`
}

function updateNav() {
  const badges = { quests: overdueCount(), mistakes: dueMistakes().length }
  document.querySelectorAll('.nav-item[data-view]').forEach((node) => {
    const id = node.dataset.view
    node.setAttribute('aria-current', id === currentView ? 'page' : 'false')
    const existing = node.querySelector('.nav-item__badge')
    const count = badges[id] || 0
    if (count > 0) {
      if (existing) existing.textContent = String(count)
      else node.append(el('span', { class: 'nav-item__badge' }, String(count)))
    } else if (existing) {
      existing.remove()
    }
  })
}

/* ---------------- 勋章结算 ---------------- */

// 同一次打开网站里，每枚勋章只提示一次（重绘会反复调用 checkMedals）
const announcedMedals = new Set()

function checkMedals() {
  const cd = examCountdown(state.profile.examDate)
  const snapshot = buildSnapshot({ stats: stats(), state, daysLeft: cd.days })
  const newly = findNewlyUnlocked(snapshot, state.medals.unlocked || {})
  const unannounced = newly.filter((medal) => !announcedMedals.has(medal.id))
  if (!unannounced.length) return

  const now = new Date().toISOString()
  for (const medal of newly) {
    state.medals.unlocked[medal.id] = state.medals.unlocked[medal.id] || now
    announcedMedals.add(medal.id)
  }
  commit('medals:unlock')

  // 最多弹 2 条，其余合并成一条汇总，避免一次堆一大片挡住页面内容
  const HEAD = 2
  unannounced.slice(0, HEAD).forEach((medal, i) => {
    setTimeout(() => {
      toast(`解锁勋章 · ${medal.name}`, { kind: 'medal', ms: 4200, iconName: 'medal' })
      celebrate()
    }, i * 420)
  })
  if (unannounced.length > HEAD) {
    setTimeout(() => {
      toast(`还有 ${unannounced.length - HEAD} 枚勋章也解锁了，去勋章墙看看`, {
        kind: 'medal',
        ms: 4200,
        iconName: 'medal'
      })
    }, HEAD * 420)
  }
}

/** 解锁时撒一把光点：纯 DOM + transform，不用 canvas */
function celebrate() {
  if (REDUCED) return
  const host = el('div', {
    style: {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '90',
      overflow: 'hidden'
    },
    'aria-hidden': 'true'
  })
  for (let i = 0; i < 22; i++) {
    const size = 6 + (i % 4) * 3
    const spark = el('div', {
      style: {
        position: 'absolute',
        left: `${50 + (i % 2 ? 1 : -1) * (i * 2.2)}%`,
        top: `${18 + (i % 5) * 4}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: i % 3 === 0 ? '50%' : '2px',
        background:
          i % 4 === 0 ? 'var(--star)' : i % 3 === 0 ? 'var(--hoshino)' : 'var(--accent)',
        transform: 'translate(-50%, 0)',
        opacity: '1',
        transition: `transform ${900 + (i % 5) * 120}ms cubic-bezier(.2,.8,.3,1), opacity ${900 + (i % 5) * 120}ms ease`
      }
    })
    host.append(spark)
    requestAnimationFrame(() => {
      spark.style.transform = `translate(-50%, ${180 + (i % 7) * 30}px) rotate(${(i % 2 ? 1 : -1) * 220}deg)`
      spark.style.opacity = '0'
    })
  }
  document.body.append(host)
  setTimeout(() => host.remove(), 1600)
}

/* ---------------- 初始化 ---------------- */

function boot() {
  applyTheme(state.settings.theme || 'light')

  const shells = buildShell()
  mainNode = shells.main

  // 订阅数据变化：任何 store 改动都会重绘当前视图
  subscribe(() => scheduleRender())

  window.addEventListener('hashchange', () => {
    render()
    window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' })
  })

  enableSpotlight(document.body)
  installShortcuts()

  if (!state.phases.length) {
    // 第一次打开：把阶段计划先排好，首页立刻有内容
    generatePhases(new Date(), state.profile.examDate)
  }

  // 逾期提醒（只提醒，不自动改数据）
  const overdue = overdueCount()
  if (overdue > 0 && !state.onboarded) {
    setTimeout(() => {
      toast(`有 ${overdue} 条逾期委托，去「每日委托」处理一下`, { kind: 'info', ms: 4000 })
    }, 1200)
  }

  if (!state.onboarded) showWelcome()

  render()
}

/* ---------------- 首次引导 ---------------- */

function showWelcome() {
  const examInput = el('input', { class: 'input', type: 'date', value: state.profile.examDate })
  const nickInput = el('input', { class: 'input', value: state.profile.nickname || 'Sensei', placeholder: '你想被怎么称呼' })
  const schoolInput = el('input', { class: 'input', value: state.profile.targetSchool || '', placeholder: '目标院校（可留空，之后在设置里补）' })

  setTimeout(() => {
    openModal({
      title: '欢迎来到作战本部',
      body: el('div', { class: 'stack' }, [
        el('p', { class: 'dim', style: { lineHeight: '1.8' } },
          '先把三件事定下来，剩下的交给这个站：它会算倒计时、排阶段、管每天的委托、记录你学了多久。'),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '初试日期'), examInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '怎么称呼你'), nickInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '目标院校'), schoolInput]),
        el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem', fontSize: '0.8125rem', lineHeight: '1.75' } }, [
          el('div', { style: { fontWeight: '700' } }, '接下来建议的顺序'),
          el('div', {}, '1. 去「阶段计划」点一次生成，四段时间表就有了'),
          el('div', {}, '2. 在「阶段计划 → 导入目录」里把教材目录贴进来，它会自动排成每日委托'),
          el('div', {}, '3. 每天打开首页勾委托、跑番茄钟，坚持天数会自动累计')
        ])
      ]),
      actions: [
        {
          label: '开始',
          kind: 'primary',
          onClick: () => {
            updateProfile({
              examDate: examInput.value || state.profile.examDate,
              nickname: nickInput.value.trim() || 'Sensei',
              targetSchool: schoolInput.value.trim()
            })
            state.onboarded = true
            commit('onboarded')
            toast('设置好了，从下面三件事开始吧', { kind: 'ok', iconName: 'spark' })
          }
        }
      ]
    })
  }, 700)
}

/* ---------------- 快捷键 / 命令面板 ---------------- */

function installShortcuts() {
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      openPalette()
      return
    }
    if (typing) return
    const index = Number(event.key)
    if (index >= 1 && index <= NAV.length) {
      location.hash = NAV[index - 1].id
    }
    if (event.key === '?') openPalette()
  })
}

function openPalette() {
  const listCard = (query = '') => {
    const wrap = el('div', { class: 'stack' })
    const q = query.trim().toLowerCase()
    for (const item of NAV) {
      if (q && !item.label.toLowerCase().includes(q) && !item.id.includes(q)) continue
      wrap.append(
        el('button', {
          class: 'nav-item',
          type: 'button',
          style: { width: '100%' },
          onClick: () => {
            location.hash = item.id
            modal.close()
          }
        }, [icon(item.icon, { size: 18 }), el('span', {}, item.label)])
      )
    }
    // 快捷动作
    if (!q || '顺延'.includes(q) || 'overdue'.includes(q)) {
      wrap.append(
        el('button', {
          class: 'nav-item',
          type: 'button',
          style: { width: '100%' },
          onClick: () => {
            const moved = rolloverOverdue(toDateKey(new Date()))
            toast(moved ? `已顺延 ${moved} 条委托到今天` : '没有逾期委托', { kind: 'ok' })
            modal.close()
          }
        }, [icon('refresh', { size: 18 }), el('span', {}, '把逾期委托顺延到今天')])
      )
    }
    if (wrap.childElementCount === 0) wrap.append(el('div', { class: 'empty' }, '没有匹配的页面。'))
    return wrap
  }

  const box = el('div', { class: 'stack' })
  const input = el('input', { class: 'input', placeholder: '输入页面名，或直接按数字键 1-8 切换', 'aria-label': '命令面板' })
  box.append(input, listCard())
  input.addEventListener('input', () => {
    box.replaceChildren(input, listCard(input.value))
    input.focus()
  })

  const modal = openModal({ title: '快速跳转', body: box })
  const hint = el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '1rem' } },
    '快捷键：数字 1-8 切换页面 · Ctrl/⌘ + K 打开这个面板 · Esc 关闭')
  modal.modal.append(hint)
}

boot()
