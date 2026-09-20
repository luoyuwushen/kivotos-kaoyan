/**
 * 视图 7：勋章墙
 * 连续天数、累计时长、完成委托数触发；等级与经验来自实际行为。
 */

import { el, svg, formatMinutes, examCountdown } from '../lib/utils.js'
import { state, stats, levelFromExp, todayKey, checkIn } from '../lib/store.js'
import { MEDALS, RARITY, buildSnapshot } from '../data/medals.js'
import { mascot } from '../components/characters.js'
import { progressBar, toast, emptyState } from '../components/ui.js'
import { icon } from '../components/icons.js'

let filter = 'all'

export function renderMedals(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })

  const cd = examCountdown(state.profile.examDate)
  const s = stats()
  const snapshot = buildSnapshot({ stats: s, state, daysLeft: cd.days })
  const unlocked = state.medals.unlocked || {}
  const unlockedIds = new Set(Object.keys(unlocked))

  wrap.append(levelCard(s, snapshot))
  wrap.append(statsCard(s))
  wrap.append(medalGrid(unlockedIds, snapshot, ctx))

  return wrap
}

/* ---------------- 等级 ---------------- */

function levelCard(s, snapshot) {
  const { level, into, need } = levelFromExp(state.progress.exp)
  const card = el('section', { class: 'card rise' })
  card.append(
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { class: 'section-title' }, '勋章墙'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          '只认真的做过的事：每段专注、每条完成的委托、每次打卡都会累积经验。')
      ])
    ])
  )

  card.append(
    el('div', { class: 'level-bar', style: { marginTop: '1rem' } }, [
      el('div', { class: 'level-bar__lv num' }, String(level)),
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { class: 'row row--between' }, [
          el('span', { class: 'field__label' }, `${state.profile.nickname || 'Sensei'} 的等级`),
          el('span', { class: 'dim-2 num', style: { fontSize: '0.8125rem' } }, `${into} / ${need}`)
        ]),
        el('div', { style: { marginTop: '0.4rem' } }, [progressBar((into / need) * 100, { label: '经验进度' })])
      ])
    ])
  )

  card.append(
    el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
      el('span', { class: 'tag' }, `连续 ${snapshot.streak} 天`),
      el('span', { class: 'tag' }, `最长 ${snapshot.bestStreak} 天`),
      el('span', { class: 'tag' }, `累计 ${formatMinutes(snapshot.totalFocus)}`),
      el('span', { class: 'tag' }, `完成 ${snapshot.doneQuests} 件委托`)
    ])
  )

  if (state.progress.lastCheckIn !== todayKey()) {
    card.append(
      el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
        el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          onClick: () => {
            const result = checkIn()
            toast(result.isNew ? `打卡成功，连续第 ${result.streak} 天` : '今天已经打过卡了', {
              kind: 'ok',
              iconName: 'medal'
            })
          }
        }, [icon('check', { size: 16 }), '今天打卡'])
      ])
    )
  }

  return card
}

/* ---------------- 数据快照 ---------------- */

function statsCard(s) {
  const card = el('section', { class: 'card card--flat rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, String(s.chaptersDone)),
        el('div', { class: 'stat__label' }, `完成章节（共 ${s.chapters}）`)
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, String(s.mistakesSolid)),
        el('div', { class: 'stat__label' }, `熟练错题（共 ${s.mistakes}）`)
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value num' }, String(s.focusDays)),
        el('div', { class: 'stat__label' }, '有专注记录的天数')
      ])
    ])
  )
  return card
}

/* ---------------- 勋章网格 ---------------- */

function medalGrid(unlockedIds, snapshot, ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })

  const owned = MEDALS.filter((m) => unlockedIds.has(m.id)).length
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '全部勋章'),
      el('span', { class: 'tag' }, `${owned} / ${MEDALS.length}`),
      el('div', { class: 'card__actions' }, [
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(filter === 'all'),
          onClick: () => { filter = 'all'; ctx.refresh() }
        }, '全部'),
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(filter === 'owned'),
          onClick: () => { filter = 'owned'; ctx.refresh() }
        }, '已获得'),
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(filter === 'locked'),
          onClick: () => { filter = 'locked'; ctx.refresh() }
        }, '未获得')
      ])
    ])
  )

  const list = MEDALS.filter((m) =>
    filter === 'all' ? true : filter === 'owned' ? unlockedIds.has(m.id) : !unlockedIds.has(m.id)
  )

  if (!list.length) {
    card.append(emptyState('这个筛选下没有勋章。'))
    return card
  }

  const grid = el('div', { class: 'medal-grid' })
  for (const medal of list) {
    const isOwned = unlockedIds.has(medal.id)
    const rarity = RARITY[medal.rarity]
    const progress = isOwned ? null : medalProgress(medal, snapshot)
    grid.append(
      el('div', {
        class: 'medal card--spot',
        dataset: { locked: String(!isOwned) },
        title: medal.desc
      }, [
        !isOwned ? el('span', { class: 'medal__lock' }, '未解锁') : null,
        medalIcon(medal, isOwned),
        el('div', { class: 'medal__name' }, medal.name),
        el('div', { class: 'medal__owner' }, `授予：${ownerName(medal.owner)}`),
        el('div', { class: 'medal__desc' }, medal.desc),
        progress
          ? el('div', { style: { width: '100%' } }, [
              progressBar(progress.percent, { thin: true, label: `${medal.name}进度` }),
              el('div', { class: 'dim-2 num', style: { fontSize: '0.6875rem', marginTop: '0.25rem' } }, progress.text)
            ])
          : null,
        isOwned
          ? el('div', { class: 'dim-2', style: { fontSize: '0.6875rem' } },
              `获得于 ${new Date(state.medals.unlocked[medal.id]).toLocaleDateString('zh-CN')}`)
          : null
      ])
    )
  }
  card.append(grid)
  return card
}

function ownerName(id) {
  return { hoshino: '小鸟游星野', arona: '阿洛娜', plana: '普拉娜' }[id] || '学园事务局'
}

/* ---------------- 勋章图标 ---------------- */

function medalIcon(medal, owned) {
  const rarity = RARITY[medal.rarity]
  const color = owned ? rarity.color : 'var(--text-tertiary)'
  const ring = owned ? rarity.ring : 'var(--surface-alt)'
  const SHAPES = {
    hoshino: 'M50 22l6.5 13.2 14.6 2.1-10.6 10.3 2.5 14.5L50 55.4l-13 6.7 2.5-14.5-10.6-10.3 14.6-2.1Z',
    arona: 'M50 20l7 12 13.6-3.3-3.3 13.6 12 7-12 7 3.3 13.6L56.6 66 50 78l-6.6-12-13.7 3.3 3.3-13.6-12-7 12-7-3.3-13.6L43.4 32Z',
    plana: 'M50 22 62 34 76 30 72 44 84 50 72 56 76 70 62 66 50 78 38 66 24 70 28 56 16 50 28 44 24 30 38 34Z'
  }
  return svg('svg', { class: 'medal__icon', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [
    svg('circle', { cx: 50, cy: 50, r: 42, fill: ring }),
    svg('circle', {
      cx: 50, cy: 50, r: 42, fill: 'none', stroke: color, 'stroke-width': 4,
      'stroke-dasharray': owned ? '0' : '10 8', opacity: owned ? 1 : 0.6
    }),
    svg('path', { d: SHAPES[medal.owner] || SHAPES.arona, fill: color, opacity: owned ? 0.95 : 0.5 }),
    svg('ellipse', {
      cx: 50, cy: 19, rx: 17, ry: 5, fill: 'none',
      stroke: color, 'stroke-width': 3, opacity: owned ? 0.9 : 0.45
    })
  ])
}

/* ---------------- 进度提示：告诉用户"差多少" ---------------- */

function medalProgress(medal, snapshot) {
  const s = snapshot
  const RULES = {
    first_quest: ['doneQuests', s.doneQuests, 1],
    quest_50: ['doneQuests', s.doneQuests, 50],
    quest_300: ['doneQuests', s.doneQuests, 300],
    quest_1000: ['doneQuests', s.doneQuests, 1000],
    focus_first: ['totalFocusMin', s.totalFocusMin, 25],
    focus_10h: ['totalFocusMin', s.totalFocusMin, 600],
    focus_100h: ['totalFocusMin', s.totalFocusMin, 6000],
    focus_500h: ['totalFocusMin', s.totalFocusMin, 30000],
    streak_3: ['bestStreak', s.bestStreak, 3],
    streak_7: ['bestStreak', s.bestStreak, 7],
    streak_30: ['bestStreak', s.bestStreak, 30],
    streak_100: ['bestStreak', s.bestStreak, 100],
    chapter_10: ['chaptersDone', s.chaptersDone, 10],
    chapter_50: ['chaptersDone', s.chaptersDone, 50],
    mistake_10: ['mistakes', s.mistakes, 10],
    mistake_solid_20: ['mistakesSolid', s.mistakesSolid, 20],
    all_subjects: ['subjectsCovered', s.subjectsCovered, 4]
  }
  const rule = RULES[medal.id]
  if (!rule) {
    // 天数类与特殊类：给一句方向性提示，不硬凑数字
    return { percent: 0, text: '继续积累就会解锁' }
  }
  const [, value, target] = rule
  const isTime = medal.id.startsWith('focus')
  const fmt = (v) => (isTime ? formatMinutes(v) : String(v))
  return {
    percent: Math.min((value / target) * 100, 100),
    text: `${fmt(Math.min(value, target))} / ${fmt(target)}`
  }
}
