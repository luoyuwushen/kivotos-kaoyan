/**
 * 视图 5：错题本 / 知识点清单
 * 记一条 → 按间隔复习 → 熟练度升到「熟练」就基本不用再看了。
 */

import { el, formatDateCN, toDateKey, relativeDayLabel, addDays } from '../lib/utils.js'
import { state, addMistake, reviewMistake, removeMistake, updateMistake, dueMistakes, SUBJECTS, subjectById } from '../lib/store.js'
import { icon } from '../components/icons.js'
import { emptyState, levelDots, toast, openModal, confirmDialog } from '../components/ui.js'
import { EMPTY_HINTS } from '../data/dialogues.js'

const LEVEL_LABEL = { weak: '生疏', ok: '一般', solid: '熟练' }
let filter = 'all'
let onlyDue = false

export function renderMistakes(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })
  const due = dueMistakes()
  const list = state.mistakes
    .filter((m) => (filter === 'all' || m.subject === filter) && (!onlyDue || due.includes(m)))
    .sort((a, b) => {
      const order = { weak: 0, ok: 1, solid: 2 }
      return order[a.level] - order[b.level] || String(a.nextReview).localeCompare(String(b.nextReview))
    })

  /* 顶部 */
  const head = el('section', { class: 'card rise' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { class: 'section-title' }, '错题本'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          '错一次记一条。复习一轮熟练度升一级，间隔按 1 天 → 3 天 → 7 天 拉开。')
      ]),
      el('button', {
        class: 'btn btn--sm btn--primary',
        type: 'button',
        onClick: () => addMistakeDialog(ctx)
      }, [icon('plus', { size: 16 }), '记一条'])
    ])
  ])

  if (due.length) {
    head.append(
      el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
        el('span', { class: 'tag tag--warn' }, `今天该复习 ${due.length} 条`),
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          onClick: () => { onlyDue = true; ctx.refresh() }
        }, '只看待复习')
      ])
    )
  }

  wrap.append(head)

  /* 统计 */
  const solid = state.mistakes.filter((m) => m.level === 'solid').length
  wrap.append(
    el('section', { class: 'card card--flat rise', dataset: { reveal: '' } }, [
      el('div', { class: 'stat-row' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, String(state.mistakes.length)),
          el('div', { class: 'stat__label' }, '总条目')
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, String(due.length)),
          el('div', { class: 'stat__label' }, '待复习')
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value num' }, String(solid)),
          el('div', { class: 'stat__label' }, '已到熟练')
        ])
      ])
    ])
  )

  /* 筛选 */
  const filterRow = el('div', { class: 'row' }, [
    el('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === 'all'), onClick: () => { filter = 'all'; ctx.refresh() } }, '全部科目'),
    ...SUBJECTS.map((s) =>
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(filter === s.id),
        onClick: () => { filter = s.id; ctx.refresh() }
      }, s.name)
    ),
    el('span', { style: { flex: '1' } }),
    el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(onlyDue),
      onClick: () => { onlyDue = !onlyDue; ctx.refresh() }
    }, '只看待复习')
  ])

  /* 列表 */
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  card.append(el('div', { class: 'card__head' }, [el('h2', { class: 'section-title' }, '知识点清单')]))
  card.append(filterRow)

  if (!list.length) {
    card.append(
      el('div', { style: { marginTop: '0.875rem' } }, [
        emptyState(
          state.mistakes.length && (onlyDue || filter !== 'all')
            ? '这个筛选下没有条目。切回「全部科目」看看。'
            : EMPTY_HINTS.mistakes,
          '记第一条',
          () => addMistakeDialog(ctx)
        )
      ])
    )
  } else {
    const body = el('div', { class: 'stack', style: { marginTop: '0.875rem' } })
    for (const item of list) body.append(mistakeRow(item, ctx))
    card.append(body)
  }

  wrap.append(card)
  return wrap
}

function mistakeRow(item, ctx) {
  const subject = subjectById(item.subject)
  const isDue = dueMistakes().includes(item)
  return el('div', { class: 'item' }, [
    el('div', {}, [
      el('div', { class: 'row', style: { gap: '0.5rem' } }, [
        el('span', { class: `tag tag--${subject.tone}` }, subject.name),
        levelDots(item.level),
        el('span', { class: 'dim-2', style: { fontSize: '0.75rem' } }, LEVEL_LABEL[item.level]),
        isDue ? el('span', { class: 'tag tag--warn' }, '待复习') : null
      ]),
      el('div', { class: 'item__title', style: { marginTop: '0.25rem' } }, item.topic),
      item.note ? el('div', { class: 'item__sub' }, item.note) : null,
      el('div', { class: 'item__sub' }, [
        `复习 ${item.rounds} 轮`,
        item.lastReview ? ` · 上次 ${formatDateCN(item.lastReview, false)}` : '',
        item.nextReview ? ` · 下次 ${relativeDayLabel(item.nextReview)}` : ''
      ].join(''))
    ]),
    el('div', { class: 'row', style: { gap: '0.25rem' } }, [
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        onClick: () => {
          const updated = reviewMistake(item.id)
          toast(
            updated.level === 'solid'
              ? '这条已经到「熟练」了，间隔拉长到 7 天'
              : `熟练度升到「${LEVEL_LABEL[updated.level]}」`,
            { kind: 'ok', iconName: 'check' }
          )
          ctx.refresh()
        }
      }, item.level === 'solid' ? '再复习一轮' : '复习一轮'),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '编辑',
        onClick: () => editMistakeDialog(item, ctx)
      }, icon('edit')),
      el('button', {
        class: 'icon-btn icon-btn--danger',
        type: 'button',
        'aria-label': '删除',
        onClick: async () => {
          const ok = await confirmDialog({
            title: '删除这条？',
            message: `「${item.topic}」会被永久删除。`,
            confirmLabel: '删除',
            danger: true
          })
          if (!ok) return
          removeMistake(item.id)
          toast('已删除', { kind: 'info', iconName: 'trash' })
          ctx.refresh()
        }
      }, icon('trash'))
    ])
  ])
}

export function addMistakeDialog(ctx) {
  const subjectSelect = el('select', { class: 'select' }, SUBJECTS.map((s) => el('option', { value: s.id }, s.name)))
  const topicInput = el('input', { class: 'input', placeholder: '例如：中值定理证明题 / 定积分换元' })
  const noteInput = el('textarea', { class: 'textarea', placeholder: '错在哪、正确思路是什么（可留空）', style: { minHeight: '92px' } })
  const levelSelect = el('select', { class: 'select' }, [
    el('option', { value: 'weak' }, '生疏（还不太会）'),
    el('option', { value: 'ok' }, '一般（会但不稳）'),
    el('option', { value: 'solid' }, '熟练（已经掌握）')
  ])

  openModal({
    title: '记一条错题 / 薄弱点',
    body: el('div', { class: 'stack' }, [
      el('div', { class: 'grid-auto' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '科目'), subjectSelect]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '当前掌握程度'), levelSelect])
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '知识点 / 题目'), topicInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '错因与思路'), noteInput])
    ]),
    actions: [
      { label: '取消' },
      {
        label: '记下来',
        kind: 'primary',
        onClick: () => {
          const created = addMistake({
            subject: subjectSelect.value,
            topic: topicInput.value,
            note: noteInput.value,
            level: levelSelect.value
          })
          if (!created) {
            toast('知识点不能为空', { kind: 'error' })
            return false
          }
          toast('已记录，明天会提醒你复习', { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}

function editMistakeDialog(item, ctx) {
  const topicInput = el('input', { class: 'input', value: item.topic })
  const noteInput = el('textarea', { class: 'textarea', value: item.note, style: { minHeight: '92px' } })
  const levelSelect = el('select', { class: 'select' }, [
    el('option', { value: 'weak', selected: item.level === 'weak' }, '生疏'),
    el('option', { value: 'ok', selected: item.level === 'ok' }, '一般'),
    el('option', { value: 'solid', selected: item.level === 'solid' }, '熟练')
  ])

  openModal({
    title: '编辑条目',
    body: el('div', { class: 'stack' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '知识点 / 题目'), topicInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '错因与思路'), noteInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '掌握程度'), levelSelect])
    ]),
    actions: [
      { label: '取消' },
      {
        label: '保存',
        kind: 'primary',
        onClick: () => {
          updateMistake(item.id, {
            topic: topicInput.value,
            note: noteInput.value,
            level: levelSelect.value
          })
          toast('已保存', { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}
