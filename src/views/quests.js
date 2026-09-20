/**
 * 视图 2：每日委托
 * 按日期查看、勾选、添加、管理每天要做的事。
 */

import { el, toDateKey, addDays, formatDateCN, relativeDayLabel, formatMinutes } from '../lib/utils.js'
import {
  state,
  questsOn,
  addQuest,
  removeQuest,
  toggleQuest,
  updateQuest,
  rolloverOverdue,
  subjectById,
  subjectName,
  SUBJECTS,
  focusMinutesOn,
  overdueCount
} from '../lib/store.js'
import { icon } from '../components/icons.js'
import { emptyState, progressBar, toast, openModal, confirmDialog } from '../components/ui.js'
import { questRow, editQuestDialog } from './home.js'
import { EMPTY_HINTS } from '../data/dialogues.js'

// 当前查看的日期（跨切换保留）
let cursorDate = toDateKey(new Date())
let filterSubject = 'all'
let showDone = true

export function renderQuests(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })
  const list = questsOn(cursorDate)
  const filtered = list.filter(
    (q) => (filterSubject === 'all' || q.subject === filterSubject) && (showDone || !q.done)
  )
  const doneCount = list.filter((q) => q.done).length
  const estTotal = list.reduce((sum, q) => sum + (q.estMin || 0), 0)
  const actual = focusMinutesOn(cursorDate)

  /* --- 顶部：日期导航 --- */
  const head = el('section', { class: 'card rise' }, [
    el('div', { class: 'row row--between' }, [
      el('div', { class: 'row' }, [
        el(
          'button',
          { class: 'icon-btn', type: 'button', 'aria-label': '前一天', onClick: () => shiftDay(-1, ctx) },
          icon('arrowRight', { size: 18, className: 'flip-x' })
        ),
        el('div', {}, [
          el('h1', { class: 'section-title' }, formatDateCN(cursorDate)),
          el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, relativeDayLabel(cursorDate))
        ]),
        el(
          'button',
          { class: 'icon-btn', type: 'button', 'aria-label': '后一天', onClick: () => shiftDay(1, ctx) },
          icon('arrowRight', { size: 18 })
        )
      ]),
      el('div', { class: 'row' }, [
        el('input', {
          class: 'input',
          type: 'date',
          value: cursorDate,
          'aria-label': '选择日期',
          style: { width: '160px', minHeight: '40px' },
          onChange: (event) => {
            cursorDate = event.target.value || cursorDate
            ctx.refresh()
          }
        }),
        el('button', { class: 'btn btn--sm', type: 'button', onClick: () => { cursorDate = toDateKey(new Date()); ctx.refresh() } }, '今天')
      ])
    ])
  ])

  if (overdueCount() > 0) {
    head.append(
      el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
        el('span', { class: 'tag tag--error' }, `${overdueCount()} 条逾期未完成`),
        el(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onClick: () => {
              const moved = rolloverOverdue(toDateKey(new Date()))
              toast(`已顺延 ${moved} 条到今天`, { kind: 'ok' })
              ctx.refresh()
            }
          },
          '顺延到今天'
        )
      ])
    )
  }

  wrap.append(head)

  /* --- 统计条 --- */
  wrap.append(
    el('section', { class: 'card card--flat rise', dataset: { reveal: '' } }, [
      el('div', { class: 'stat-row' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, `${doneCount}/${list.length}`),
          el('div', { class: 'stat__label' }, '委托完成')
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, formatMinutes(estTotal)),
          el('div', { class: 'stat__label' }, '预计投入')
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, formatMinutes(actual)),
          el('div', { class: 'stat__label' }, '实际专注')
        ])
      ]),
      el('div', { class: 'quest-progress', style: { marginTop: '0.875rem' } }, [
        progressBar(list.length ? (doneCount / list.length) * 100 : 0, { label: '完成度' }),
        el('span', { class: 'num' }, `${list.length ? Math.round((doneCount / list.length) * 100) : 0}%`)
      ])
    ])
  )

  /* --- 筛选 + 添加 --- */
  const filterRow = el('div', { class: 'row' }, [
    chip('全部科目', filterSubject === 'all', () => { filterSubject = 'all'; ctx.refresh() }),
    ...SUBJECTS.map((s) => chip(s.name, filterSubject === s.id, () => { filterSubject = s.id; ctx.refresh() })),
    el('span', { style: { flex: '1' } }),
    chip(showDone ? '隐藏已完成' : '显示已完成', false, () => { showDone = !showDone; ctx.refresh() }),
    el(
      'button',
      { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => addQuestDialog(cursorDate, ctx) },
      [icon('plus', { size: 16 }), '添加委托']
    )
  ])

  /* --- 列表 --- */
  const listCard = el('section', { class: 'card rise', dataset: { reveal: '' } })
  listCard.append(el('div', { class: 'card__head' }, [el('h2', { class: 'section-title' }, '委托清单')]))
  listCard.append(filterRow)

  if (!filtered.length) {
    listCard.append(
      el('div', { style: { marginTop: '0.875rem' } }, [
        emptyState(
          list.length && !showDone ? '这一天的委托都完成了。要不要切到「显示已完成」回顾一下？' : EMPTY_HINTS.quests,
          '去阶段计划自动排期',
          () => ctx.go('plan')
        )
      ])
    )
  } else {
    const body = el('div', { style: { marginTop: '0.5rem' } })
    for (const quest of filtered) body.append(questRow(quest, ctx, { showDate: false }))
    listCard.append(body)
  }

  wrap.append(listCard)

  /* --- 批量操作 --- */
  if (list.length) {
    wrap.append(
      el('section', { class: 'card card--flat rise', dataset: { reveal: '' } }, [
        el('div', { class: 'row' }, [
          el(
            'button',
            {
              class: 'btn btn--sm',
              type: 'button',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: '把未完成的委托挪到明天？',
                  message: '这一天的未完成项会全部改到明天的清单里，已完成的保持不动。',
                  confirmLabel: '挪到明天'
                })
                if (!ok) return
                const pending = list.filter((q) => !q.done)
                const target = toDateKey(addDays(cursorDate, 1))
                for (const q of pending) updateQuest(q.id, { date: target })
                toast(`已挪动 ${pending.length} 条到明天`, { kind: 'ok' })
                ctx.refresh()
              }
            },
            '未完成挪到明天'
          ),
          el(
            'button',
            {
              class: 'btn btn--sm',
              type: 'button',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: '清空这一天的委托？',
                  message: `会删除 ${list.length} 条委托，这个操作不能撤销。`,
                  confirmLabel: '清空',
                  danger: true
                })
                if (!ok) return
                for (const q of list) removeQuest(q.id)
                toast('已清空', { kind: 'info', iconName: 'trash' })
                ctx.refresh()
              }
            },
            '清空这一天'
          ),
          el(
            'button',
            {
              class: 'btn btn--sm btn--ghost',
              type: 'button',
              onClick: async () => {
                if (!list.length) return
                const ok = await confirmDialog({
                  title: '全部标记为已完成？',
                  message: '适合「今天做了但忘了逐条勾」的情况。',
                  confirmLabel: '全部完成'
                })
                if (!ok) return
                for (const q of list) if (!q.done) toggleQuest(q.id, true)
                toast('已全部标记完成', { kind: 'ok', iconName: 'check' })
                ctx.refresh()
              }
            },
            '全部标记完成'
          )
        ])
      ])
    )
  }

  return wrap
}

function shiftDay(delta, ctx) {
  cursorDate = toDateKey(addDays(cursorDate, delta))
  ctx.refresh()
}

function chip(label, active, onClick) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(active)), onClick }, label)
}

/** 快速添加委托弹窗 */
export function addQuestDialog(date, ctx, presetSubject) {
  const titleInput = el('input', { class: 'input', placeholder: '例如：高数 第一章 课后题 1-20' })
  const subjectSelect = el(
    'select',
    { class: 'select' },
    SUBJECTS.map((s) => el('option', { value: s.id, selected: s.id === (presetSubject || 'math') }, s.name))
  )
  const estInput = el('input', { class: 'input', type: 'number', min: '0', step: '5', value: '60', placeholder: '分钟' })
  const dateInput = el('input', { class: 'input', type: 'date', value: date })

  const quickAdd = el('div', { class: 'row' })
  const PRESETS = [
    ['背单词 100 个', 'english', 30],
    ['英语阅读 2 篇精读', 'english', 60],
    ['数学一章 + 课后题', 'math', 120],
    ['政治一节 + 做题', 'politics', 60],
    ['专业课一章 + 笔记', 'major', 90],
    ['真题一套（限时）', 'math', 180]
  ]
  for (const [label, subject, min] of PRESETS) {
    quickAdd.append(
      el(
        'button',
        {
          class: 'chip',
          type: 'button',
          onClick: () => {
            titleInput.value = label
            subjectSelect.value = subject
            estInput.value = String(min)
            titleInput.focus()
          }
        },
        label
      )
    )
  }

  const form = el('div', { class: 'stack' }, [
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '要做什么'), titleInput]),
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '科目'), subjectSelect]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '预计分钟'), estInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '日期'), dateInput])
    ]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '常用快捷'), quickAdd])
  ])

  openModal({
    title: '添加委托',
    body: form,
    actions: [
      { label: '取消' },
      {
        label: '添加',
        kind: 'primary',
        onClick: () => {
          const quest = addQuest({
            title: titleInput.value,
            subject: subjectSelect.value,
            date: dateInput.value || date,
            estMin: Number(estInput.value) || 0
          })
          if (!quest) {
            toast('内容不能为空', { kind: 'error' })
            return false
          }
          toast('已添加', { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}
