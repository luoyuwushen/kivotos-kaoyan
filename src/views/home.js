/**
 * 视图 1：作战本部（首页）
 * Bento 不等大栅格：倒计时占满一行，其下是今日委托（大）、进度、台词、里程碑。
 */

import { el } from '../lib/utils.js'
import {
  state,
  stats,
  todayKey,
  questsOn,
  toggleQuest,
  removeQuest,
  updateQuest,
  currentPhase,
  phaseProgress,
  overdueCount,
  rolloverOverdue,
  goalSummary,
  subjectById
} from '../lib/store.js'
import { examCountdown, formatDateCN, relativeDayLabel, formatMinutes, toDateKey } from '../lib/utils.js'
import { icon } from '../components/icons.js'
import { hoshinoLine, aronaLine, pickScene, EMPTY_HINTS } from '../data/dialogues.js'
import { buildSnapshot, MEDALS, RARITY } from '../data/medals.js'
import { mascot } from '../components/characters.js'
import {
  emptyState,
  progressBar,
  typewriter,
  REDUCED,
  toast,
  openModal
} from '../components/ui.js'

let speechTurn = 0

export function renderHome(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: 'clamp(1rem, 2.5vw, 1.5rem)' } })
  const cd = examCountdown(state.profile.examDate)
  const s = stats()
  const today = todayKey()

  /* --- Hero：倒计时 --- */
  const hero = el('section', { class: 'hero rise' }, [
    el('div', { class: 'countdown' }, [
      el('div', { class: 'countdown__label' }, `距 28 考研初试（${formatDateCN(state.profile.examDate, false)}）还有`),
      el('div', { class: 'countdown__num num' }, [
        el('span', { id: 'cdDays' }, String(cd.days)),
        el('span', { class: 'countdown__unit' }, '天')
      ]),
      el('div', { class: 'countdown__meta' }, [
        el('span', {}, cd.remainWeeksText),
        el('span', {}, `已走过 ${Math.max(0, 100 - Math.round((cd.days / 460) * 100))}%`),
        el('span', { class: 'countdown__phase' }, phaseText())
      ])
    ]),
    el('div', { class: 'hero__side' }, [
      state.settings.mascots.hoshino ? mascot('hoshino', { size: 132 }) : null,
      el('div', { class: 'tag tag--math' }, `Lv.${state.progress.level} ${state.profile.nickname || 'Sensei'}`)
    ])
  ])

  // 光环：两层反向旋转，放在倒计时背后（挂在 hero 上，绝对定位）
  hero.style.position = 'relative'
  hero.style.isolation = 'isolate'
  hero.style.overflow = 'hidden'
  const haloSize = 320
  hero.prepend(
    el('div', {
      class: 'halo',
      style: {
        width: `${haloSize}px`,
        height: `${haloSize}px`,
        position: 'absolute',
        left: '18%',
        top: '50%',
        marginLeft: `${-haloSize / 2}px`,
        marginTop: `${-haloSize / 2}px`
      }
    }),
    el('div', {
      class: 'halo halo--2',
      style: {
        width: `${haloSize * 0.7}px`,
        height: `${haloSize * 0.7}px`,
        position: 'absolute',
        left: '18%',
        top: '50%',
        marginLeft: `${-haloSize * 0.35}px`,
        marginTop: `${-haloSize * 0.35}px`
      }
    })
  )

  wrap.append(hero)
  startCountdownTicker(hero)

  /* --- 星野台词 --- */
  wrap.append(speechCard(ctx, cd, s))

  /* --- Bento --- */
  const bento = el('div', { class: 'bento' })

  // 今日委托（大块）
  bento.append(questCard(ctx, today, s))

  // 阶段进度
  bento.append(phaseCard(ctx))

  // 专注情况
  bento.append(focusCard(ctx, s))

  // 目标看板摘要
  bento.append(goalCard(ctx))

  wrap.append(bento)

  // 最近解锁的勋章
  const medalStrip = recentMedals(ctx)
  if (medalStrip) wrap.append(medalStrip)

  return wrap
}

function phaseText() {
  const phase = currentPhase()
  return phase ? `当前阶段：${phase.name}` : '还没有阶段计划'
}

/* ---------------- 倒计时跳秒 ---------------- */

let tickerHandle = null

function startCountdownTicker(hero) {
  clearInterval(tickerHandle)
  const daysNode = hero.querySelector('#cdDays')
  if (!daysNode) return
  // 天数是按「当天 0 点」算的，所以不需要每秒刷；但要处理跨零点
  tickerHandle = setInterval(() => {
    const cd = examCountdown(state.profile.examDate)
    const next = String(cd.days)
    if (daysNode.textContent !== next) {
      daysNode.textContent = next
      daysNode.classList.remove('countdown__digit')
      void daysNode.offsetWidth // 强制重排以重放动画
      if (!REDUCED) daysNode.classList.add('countdown__digit')
    }
  }, 30000)
}

/* ---------------- 台词卡 ---------------- */

function speechCard(ctx, cd, s) {
  const today = todayKey()
  const due = s.todayQuests
  const doneCount = due.filter((q) => q.done).length
  const phase = currentPhase()
  const pp = phaseProgress(phase)
  const scene = pickScene({
    days: cd.days,
    phaseBehind: Boolean(phase) && pp.percent > 60 && doneCount / Math.max(due.length, 1) < 0.4,
    todayTotal: due.length,
    todayDone: doneCount,
    dueMistakes: 0
  })

  const textNode = el('p', { class: 'speech__text' })
  const card = el('section', { class: 'card card--flat rise', dataset: { reveal: '' }, 'data-delay': '1' }, [
    el('div', { class: 'speech-wrap' }, [
      el('div', { class: 'speech' }, [
        el('span', { class: 'speech__who' }, '小鸟游星野'),
        textNode
      ])
    ]),
    el('div', { class: 'speech__more row' }, [
      el(
        'button',
        {
          class: 'btn btn--sm btn--ghost',
          type: 'button',
          onClick: () => {
            speechTurn += 1
            const skip = typewriter(textNode, hoshinoLine(scene, speechTurn, today), { speed: 30 })
            speakSkip = skip
          }
        },
        [icon('refresh', { size: 15 }), '再听一句']
      ),
      el('span', { class: 'dim-2', style: { fontSize: '0.75rem' } }, '点击文字可跳过打字')
    ])
  ])

  let speakSkip = typewriter(textNode, hoshinoLine(scene, speechTurn, today), { speed: 30 })
  textNode.style.cursor = 'pointer'
  textNode.addEventListener('click', () => speakSkip?.())
  return card
}

/* ---------------- 今日委托 ---------------- */

function questCard(ctx, today, s) {
  const list = questsOn(today)
  const doneCount = list.filter((q) => q.done).length
  const overdue = overdueCount()

  const card = el('section', { class: 'card card--spot span-4 rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '今日委托'),
      el('span', { class: 'tag' }, `${doneCount}/${list.length}`),
      el('div', { class: 'card__actions' }, [
        el(
          'button',
          { class: 'btn btn--sm', type: 'button', onClick: () => ctx.go('quests') },
          ['查看全部', icon('arrowRight', { size: 15 })]
        )
      ])
    ])
  )

  if (overdue > 0) {
    card.append(
      el('div', { class: 'row', style: { marginBottom: '0.75rem' } }, [
        el('span', { class: 'tag tag--error' }, `有 ${overdue} 条逾期`),
        el(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onClick: () => {
              const moved = rolloverOverdue(today)
              toast(`已把 ${moved} 条委托顺延到今天`, { kind: 'ok' })
              ctx.refresh()
            }
          },
          '顺延到今天'
        )
      ])
    )
  }

  card.append(el('div', { class: 'quest-progress', style: { marginBottom: '0.75rem' } }, [
    progressBar(list.length ? (doneCount / list.length) * 100 : 0, { label: '今日完成度' }),
    el('span', { class: 'num' }, `${list.length ? Math.round((doneCount / list.length) * 100) : 0}%`)
  ]))

  if (!list.length) {
    card.append(
      emptyState(EMPTY_HINTS.quests, '去阶段计划排期', () => ctx.go('plan'))
    )
    return card
  }

  const body = el('div', {})
  for (const quest of list.slice(0, 8)) body.append(questRow(quest, ctx))
  card.append(body)

  if (list.length > 8) {
    card.append(
      el('div', { style: { marginTop: '0.5rem' } }, [
        el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: () => ctx.go('quests') }, `还有 ${list.length - 8} 条…`)
      ])
    )
  }
  return card
}

/** 单条委托：首页与「每日委托」页共用 */
export function questRow(quest, ctx, { showDate = false } = {}) {
  const subject = subjectById(quest.subject)
  const overdue = !quest.done && quest.date < todayKey()
  const row = el('div', { class: 'quest', dataset: { done: String(quest.done), overdue: String(overdue) } }, [
    el('input', {
      class: 'quest__check',
      type: 'checkbox',
      checked: quest.done,
      'aria-label': `标记「${quest.title}」${quest.done ? '未完成' : '完成'}`,
      onChange: () => {
        const updated = toggleQuest(quest.id)
        if (updated.done) {
          const remain = questsOn(todayKey()).filter((q) => !q.done).length
          toast(remain === 0 ? '今天的委托全部完成了！' : `还剩 ${remain} 条，继续`, {
            kind: 'ok',
            iconName: remain === 0 ? 'medal' : 'check'
          })
        }
        ctx.refresh()
      }
    }),
    el('div', { class: 'quest__body' }, [
      el('div', { class: 'quest__title' }, quest.title),
      el('div', { class: 'quest__meta' }, [
        el('span', { class: `tag tag--${subject.tone}` }, subject.name),
        quest.estMin ? el('span', {}, `预计 ${formatMinutes(quest.estMin)}`) : null,
        showDate ? el('span', {}, relativeDayLabel(quest.date)) : null,
        overdue ? el('span', { class: 'tag tag--error' }, '逾期') : null,
        quest.source === 'chapter' ? el('span', { class: 'dim-2' }, '来自教材目录') : null
      ])
    ]),
    el('div', { class: 'quest__tools' }, [
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '编辑',
          onClick: () => editQuestDialog(quest, ctx)
        },
        icon('edit')
      ),
      el(
        'button',
        {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          'aria-label': '删除',
          onClick: () => {
            removeQuest(quest.id)
            toast('已删除', { kind: 'info', iconName: 'trash' })
            ctx.refresh()
          }
        },
        icon('trash')
      )
    ])
  ])
  return row
}

export function editQuestDialog(quest, ctx) {
  const titleInput = el('input', { class: 'input', value: quest.title })
  const subjectSelect = el(
    'select',
    { class: 'select' },
    ['math', 'english', 'politics', 'major'].map((id) =>
      el('option', { value: id, selected: id === quest.subject }, subjectName(id))
    )
  )
  const dateInput = el('input', { class: 'input', type: 'date', value: quest.date })
  const minInput = el('input', { class: 'input', type: 'number', min: '0', step: '5', value: quest.estMin || 0 })

  const form = el('div', { class: 'stack' }, [
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '内容'), titleInput]),
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '科目'), subjectSelect]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '日期'), dateInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '预计分钟'), minInput])
    ])
  ])

  openModal({
    title: '编辑委托',
    body: form,
    actions: [
      { label: '取消' },
      {
        label: '保存',
        kind: 'primary',
        onClick: () => {
          updateQuest(quest.id, {
            title: titleInput.value.trim() || quest.title,
            subject: subjectSelect.value,
            date: dateInput.value,
            estMin: Number(minInput.value) || 0
          })
          toast('已保存', { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}

/* ---------------- 阶段卡 ---------------- */

function phaseCard(ctx) {
  const phase = currentPhase()
  const card = el('section', { class: 'card card--spot span-2 rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '阶段'),
      el('div', { class: 'card__actions' }, [
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '去阶段计划', onClick: () => ctx.go('plan') }, icon('plan'))
      ])
    ])
  )
  if (!phase) {
    card.append(emptyState('还没排阶段。生成一次，四阶段时间表就出来了。', '去生成', () => ctx.go('plan')))
    return card
  }
  const pp = phaseProgress(phase)
  card.append(
    el('div', { class: 'stack' }, [
      el('div', { class: 'phase__name' }, phase.name),
      el('div', { class: 'phase__goal' }, phase.goal),
      el('div', { class: 'phase__pct num' }, `${pp.percent}%`),
      progressBar(pp.percent, { label: `${phase.name}进度` }),
      el('div', { class: 'phase__dates' }, `${phase.start} → ${phase.end} · 剩 ${pp.left} 天`)
    ])
  )
  return card
}

/* ---------------- 专注卡 ---------------- */

function focusCard(ctx, s) {
  const card = el('section', { class: 'card card--spot span-3 rise', dataset: { reveal: '' } })
  const goalMin = state.profile.dailyGoalMin || 360
  const percent = Math.min((s.todayMinutes / goalMin) * 100, 100)
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '今日专注'),
      el('div', { class: 'card__actions' }, [
        el('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => ctx.go('focus') }, [icon('play', { size: 15 }), '开始'])
      ])
    ])
  )
  card.append(
    el('div', { class: 'stack' }, [
      el('div', { class: 'stat-row' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, formatMinutes(s.todayMinutes)),
          el('div', { class: 'stat__label' }, '今天已学')
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, String(s.streak)),
          el('div', { class: 'stat__label' }, '连续天数')
        ])
      ]),
      el('div', { class: 'quest-progress' }, [
        progressBar(percent, { label: '今日目标' }),
        el('span', { class: 'num' }, `${Math.round(percent)}%`)
      ]),
      el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } }, `目标 ${formatMinutes(goalMin)}／天 · 累计 ${formatMinutes(s.totalFocus)}`)
    ])
  )
  return card
}

/* ---------------- 目标卡 ---------------- */

function goalCard(ctx) {
  const card = el('section', { class: 'card card--spot span-3 rise', dataset: { reveal: '' } })
  const summary = goalSummary()
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '目标'),
      el('div', { class: 'card__actions' }, [
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '去目标看板', onClick: () => ctx.go('goals') }, icon('target'))
      ])
    ])
  )
  if (!summary.target) {
    card.append(emptyState(EMPTY_HINTS.goals, '去设定目标', () => ctx.go('goals')))
    return card
  }
  const percent = summary.target ? (summary.current / summary.target) * 100 : 0
  card.append(
    el('div', { class: 'stack' }, [
      el('div', { class: 'row row--between' }, [
        el('span', { class: 'dim' }, state.profile.targetSchool || '未填目标院校'),
        el('span', { class: 'num', style: { fontWeight: '800' } }, `${summary.current} / ${summary.target}`)
      ]),
      progressBar(percent, { label: '目标分进度' }),
      el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } }, `还差 ${summary.gap} 分 · 满分 ${summary.full}`)
    ])
  )
  return card
}

/* ---------------- 勋章条 ---------------- */

function recentMedals(ctx) {
  const unlocked = state.medals.unlocked || {}
  const ids = Object.keys(unlocked)
  if (!ids.length) return null
  const latest = ids
    .sort((a, b) => new Date(unlocked[b]) - new Date(unlocked[a]))
    .slice(0, 4)
    .map((id) => MEDALS.find((m) => m.id === id))
    .filter(Boolean)
  if (!latest.length) return null

  const card = el('section', { class: 'card card--flat rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '最近获得的勋章'),
      el('div', { class: 'card__actions' }, [
        el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: () => ctx.go('medals') }, '勋章墙')
      ])
    ])
  )
  const row = el('div', { class: 'row' })
  for (const medal of latest) {
    const rarity = RARITY[medal.rarity]
    row.append(
      el('div', { class: 'tag', style: { background: rarity.ring, color: rarity.color } }, [
        icon('medal', { size: 14 }),
        medal.name
      ])
    )
  }
  card.append(row)
  return card
}
