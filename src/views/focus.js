/**
 * 视图 4：专注计时
 * 番茄钟 / 正计时 + 今日账目 + 近半年热力图。
 */

import { el, svg, formatClock, formatMinutes, toDateKey, formatDateCN, addDays } from '../lib/utils.js'
import {
  state,
  focusMinutesOn,
  focusHeatmap,
  totalFocusMinutes,
  questsOn,
  focusBySubject,
  SUBJECTS,
  todayKey,
  updateProfile
} from '../lib/store.js'
import { icon } from '../components/icons.js'
import { openModal } from '../components/ui.js'
import {
  timer,
  subscribeTimer,
  start,
  pause,
  reset,
  setMode,
  setDuration,
  setSubject,
  setQuest,
  liveRemaining,
  liveElapsed,
  progressRatio,
  modeLabel,
  isBreak,
  MODE_KEYS
} from '../lib/focus.js'
import { mascot } from '../components/characters.js'
import { EMPTY_HINTS } from '../data/dialogues.js'

const PRESETS = [15, 25, 45, 60, 90]
let heatDays = 182

export function renderFocus(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })

  wrap.append(headerCard())
  wrap.append(timerCard(ctx))
  wrap.append(todayCard(ctx))
  wrap.append(heatmapCard(ctx))

  return wrap
}

function headerCard() {
  return el('section', { class: 'card rise' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { class: 'section-title' }, '专注计时'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          '计时以时间戳为准：切页面、合上电脑都不影响，走过的时间照算。')
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'tag' }, `已完成 ${timer.round} 段`)
      ])
    ])
  ])
}

/* ---------------- 计时卡 ---------------- */

function timerCard(ctx) {
  const stage = el('section', { class: 'card card--spot rise' })

  const RADIUS = 52
  const CIRC = 2 * Math.PI * RADIUS

  const bar = svg('circle', {
    class: 'bar',
    cx: 60,
    cy: 60,
    r: RADIUS,
    'stroke-dasharray': String(CIRC),
    'stroke-dashoffset': String(CIRC)
  })
  const ring = svg('svg', { class: 'pomo__ring', viewBox: '0 0 120 120' }, [
    svg('circle', { class: 'track', cx: 60, cy: 60, r: RADIUS }),
    bar
  ])

  const timeNode = el('div', { class: 'pomo__time num' }, '25:00')
  const modeNode = el('div', { class: 'pomo__mode' }, '专注')

  const dial = el('div', { class: 'pomo__dial' }, [ring, el('div', {}, [timeNode, modeNode])])

  /* 模式选择 */
  const modeRow = el('div', { class: 'pomo__controls' })
  const MODE_LABELS = { pomodoro: '番茄钟', short: '短休息', long: '长休息', countup: '正计时' }
  for (const key of MODE_KEYS) {
    modeRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        dataset: { mode: key },
        'aria-pressed': String(timer.mode === key),
        onClick: () => {
          setMode(key)
          syncAll()
        }
      }, MODE_LABELS[key])
    )
  }

  /* 时长预设 */
  const presetRow = el('div', { class: 'pomo__controls' })
  for (const min of PRESETS) {
    presetRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(timer.mode !== 'countup' && Math.round(timer.duration / 60) === min),
        onClick: () => {
          if (timer.mode === 'countup') setMode('pomodoro', min)
          else setDuration(min)
          syncAll()
        }
      }, `${min} 分`)
    )
  }

  /* 科目与任务 */
  const subjectSelect = el(
    'select',
    {
      class: 'select',
      'aria-label': '本次专注的科目',
      onChange: (event) => {
        setSubject(event.target.value)
        renderQuestOptions()
      }
    },
    SUBJECTS.map((s) => el('option', { value: s.id, selected: s.id === timer.subject }, s.name))
  )

  const questSelect = el('select', {
    class: 'select',
    'aria-label': '绑定今日委托（可选）',
    onChange: (event) => setQuest(event.target.value || null)
  })

  function renderQuestOptions() {
    const list = questsOn(todayKey()).filter((q) => q.subject === timer.subject)
    questSelect.replaceChildren(
      el('option', { value: '' }, '不绑定具体委托'),
      ...list.map((q) => el('option', { value: q.id, selected: q.id === timer.questId }, q.done ? `✓ ${q.title}` : q.title))
    )
  }
  renderQuestOptions()

  /* 主控按钮 */
  const mainBtn = el('button', { class: 'btn btn--primary', type: 'button' })
  const resetBtn = el('button', {
    class: 'btn',
    type: 'button',
    onClick: () => {
      reset()
      syncAll()
    }
  }, [icon('refresh', { size: 16 }), '重置'])

  mainBtn.addEventListener('click', () => {
    if (timer.running) pause()
    else start()
    syncAll()
  })

  const controls = el('div', { class: 'pomo__controls' }, [mainBtn, resetBtn])

  const panel = el('div', { class: 'stack' }, [
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '科目'), subjectSelect]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '绑定委托'), questSelect])
    ]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '模式'), modeRow]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '时长'), presetRow]),
    controls,
    el('div', { class: 'dim-2', style: { fontSize: '0.75rem', lineHeight: '1.7' } },
      '提示：一段专注结束会自动记账并切到休息。浏览器通知与提示音需要在设置里开启权限。')
  ])

  const pomo = el('div', { class: 'pomo', dataset: { mode: timer.mode } }, [
    dial,
    panel
  ])

  if (state.settings.mascots.hoshino) {
    pomo.append(el('div', { style: { gridColumn: '1 / -1', display: 'flex', justifyContent: 'center' } }, [mascot('hoshino', { size: 88 })]))
  }

  stage.append(pomo)

  /* --- 同步显示 --- */
  function syncAll() {
    const remaining = liveRemaining()
    const elapsed = liveElapsed()
    timeNode.textContent = formatClock(timer.mode === 'countup' ? elapsed : remaining)
    modeNode.textContent = modeLabel()
    pomo.dataset.mode = isBreak() ? 'break' : 'focus'
    const ratio = progressRatio()
    bar.setAttribute('stroke-dashoffset', String(CIRC * (1 - ratio)))

    mainBtn.replaceChildren(
      icon(timer.running ? 'pause' : 'play', { size: 17 }),
      document.createTextNode(timer.running ? '暂停' : timer.mode === 'countup' ? '开始计时' : '开始专注')
    )
    modeRow.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.mode === timer.mode))
    })
    presetRow.querySelectorAll('.chip').forEach((chip, i) => {
      chip.setAttribute(
        'aria-pressed',
        String(timer.mode !== 'countup' && Math.round(timer.duration / 60) === PRESETS[i])
      )
    })
    subjectSelect.value = timer.subject
  }

  // 每 500ms 刷新一次显示；切到别的视图时自动解绑
  const unsubscribe = subscribeTimer(syncAll)
  const localTick = setInterval(syncAll, 500)
  ctx.onDestroy(() => {
    unsubscribe()
    clearInterval(localTick)
  })

  syncAll()
  return stage
}

/* ---------------- 今日账目 ---------------- */

function todayCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  const today = todayKey()
  const todayMin = focusMinutesOn(today)
  const goal = state.profile.dailyGoalMin || 360
  const bySubject = focusBySubject(today)

  card.append(el('div', { class: 'card__head' }, [el('h2', { class: 'section-title' }, '今日账目')]))

  const goalInput = el('input', {
    class: 'input score-input',
    type: 'number',
    min: '30',
    step: '30',
    value: String(goal),
    'aria-label': '每日目标分钟'
  })
  goalInput.addEventListener('change', () => {
    updateProfile({ dailyGoalMin: Math.max(30, Number(goalInput.value) || 360) })
    ctx.refresh()
  })

  card.append(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, formatMinutes(todayMin)),
        el('div', { class: 'stat__label' }, '今天已专注')
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, `${Math.round((todayMin / goal) * 100)}%`),
        el('div', { class: 'stat__label' }, '目标完成度')
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, formatMinutes(totalFocusMinutes())),
        el('div', { class: 'stat__label' }, '累计专注')
      ])
    ])
  )

  card.append(
    el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
      el('span', { class: 'field__label' }, '每日目标（分钟）'),
      goalInput
    ])
  )

  if (bySubject.length) {
    const list = el('div', { class: 'stack', style: { marginTop: '1rem' } })
    const max = Math.max(...bySubject.map((s) => s.minutes), 1)
    for (const item of bySubject) {
      list.append(
        el('div', { class: 'subject-score' }, [
          el('span', { class: 'subject-score__name' }, item.name),
          el('div', { class: 'progress progress--thin' }, [
            el('div', { class: 'progress__fill', style: { width: `${(item.minutes / max) * 100}%` } })
          ]),
          el('span', { class: 'subject-score__nums num' }, formatMinutes(item.minutes))
        ])
      )
    }
    card.append(el('div', { class: 'field', style: { marginTop: '1rem' } }, [
      el('span', { class: 'field__label' }, '各科分布'),
      list
    ]))
  } else {
    card.append(el('div', { class: 'empty' }, EMPTY_HINTS.focus))
  }

  return card
}

/* ---------------- 热力图 ---------------- */

function heatmapCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '坚持记录'),
      el('div', { class: 'card__actions' }, [
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(heatDays === 182),
          onClick: () => { heatDays = 182; ctx.refresh() }
        }, '近半年'),
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(heatDays === 365),
          onClick: () => { heatDays = 365; ctx.refresh() }
        }, '近一年')
      ])
    ])
  )

  const cells = focusHeatmap(heatDays)
  const max = Math.max(...cells.map((c) => c.minutes), 1)
  const grid = el('div', { class: 'heatmap', role: 'img', 'aria-label': `近 ${heatDays} 天每日专注热力图` })

  // 网格按列（周）填充：从第一天对齐到周一
  const firstDate = new Date(cells[0].date)
  const pad = (firstDate.getDay() + 6) % 7 // 周一为 0
  for (let i = 0; i < pad; i++) grid.append(el('div', { style: { visibility: 'hidden' } }))

  const today = toDateKey(new Date())
  for (const cell of cells) {
    const level = cell.minutes === 0 ? 0 : Math.min(4, Math.ceil((cell.minutes / max) * 4))
    grid.append(
      el('div', {
        class: 'heatmap__cell',
        dataset: { lv: String(level), today: String(cell.date === today) },
        title: `${cell.date} · ${cell.minutes ? formatMinutes(cell.minutes) : '没有记录'}`
      })
    )
  }

  card.append(grid)
  card.append(
    el('div', { class: 'row row--between', style: { marginTop: '0.5rem' } }, [
      el('div', { class: 'heatmap__legend' }, [
        el('span', {}, '少'),
        ...[0, 1, 2, 3, 4].map((lv) => el('div', { class: 'heatmap__cell', dataset: { lv: String(lv) } })),
        el('span', {}, '多')
      ]),
      el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } },
        `${formatDateCN(addDays(new Date(), -(heatDays - 1)), false)} 至今`)
    ])
  )

  // 汇总
  const activeDays = cells.filter((c) => c.minutes > 0).length
  const total = cells.reduce((s, c) => s + c.minutes, 0)
  card.append(
    el('div', { class: 'stat-row', style: { marginTop: '1rem' } }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, String(activeDays)),
        el('div', { class: 'stat__label' }, `有学习的日子（共 ${heatDays} 天）`)
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, formatMinutes(total)),
        el('div', { class: 'stat__label' }, '区间总时长')
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, formatMinutes(activeDays ? Math.round(total / activeDays) : 0)),
        el('div', { class: 'stat__label' }, '平均每天（有学的日子）')
      ])
    ])
  )

  return card
}
