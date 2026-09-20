/**
 * 视图 6：目标看板
 * 目标院校 + 各科目标分拆解 + 差距可视化 + 分数线参考。
 */

import { el, examCountdown, formatDateCN } from '../lib/utils.js'
import {
  state,
  setGoal,
  goalSummary,
  updateProfile,
  SUBJECTS,
  subjectById,
  addScoreLine,
  removeScoreLine
} from '../lib/store.js'
import { MATH_SCOPE, SCORE_REFERENCES, suggestTargets } from '../data/syllabus.js'
import { icon } from '../components/icons.js'
import { progressBar, toast, openModal, confirmDialog, emptyState } from '../components/ui.js'
import { EMPTY_HINTS } from '../data/dialogues.js'

let showReference = false

export function renderGoals(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })

  wrap.append(profileCard(ctx))
  wrap.append(scoresCard(ctx))
  wrap.append(referenceCard(ctx))

  return wrap
}

/* ---------------- 目标设定 ---------------- */

function profileCard(ctx) {
  const card = el('section', { class: 'card rise' })
  const cd = examCountdown(state.profile.examDate)
  const scope = MATH_SCOPE[state.profile.subjectSet] || MATH_SCOPE.math1

  const schoolInput = el('input', { class: 'input', value: state.profile.targetSchool, placeholder: '例如：某某大学' })
  const majorInput = el('input', { class: 'input', value: state.profile.targetMajor, placeholder: '例如：计算机科学与技术' })
  const dateInput = el('input', { class: 'input', type: 'date', value: state.profile.examDate })
  const setSelect = el(
    'select',
    { class: 'select' },
    Object.entries(MATH_SCOPE).map(([key, value]) =>
      el('option', { value: key, selected: key === state.profile.subjectSet }, value.name)
    )
  )

  for (const input of [schoolInput, majorInput, dateInput]) {
    input.addEventListener('change', () => {
      updateProfile({
        targetSchool: schoolInput.value.trim(),
        targetMajor: majorInput.value.trim(),
        examDate: dateInput.value || state.profile.examDate
      })
      toast('已保存', { kind: 'ok' })
      ctx.refresh()
    })
  }
  setSelect.addEventListener('change', () => {
    updateProfile({ subjectSet: setSelect.value })
    toast('已切换考试科目组合，阶段计划可重新生成', { kind: 'info' })
    ctx.refresh()
  })

  card.append(
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { class: 'section-title' }, '目标看板'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          `距初试 ${cd.days} 天 · ${scope.note}`)
      ])
    ])
  )

  card.append(
    el('div', { class: 'grid-auto', style: { marginTop: '1rem' } }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '目标院校'), schoolInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '目标专业'), majorInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '初试日期'), dateInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '数学科目'), setSelect])
    ])
  )

  return card
}

/* ---------------- 分数拆解 ---------------- */

function scoresCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  const summary = goalSummary()
  const hasMath = state.profile.subjectSet !== 'no-math'
  const activeSubjects = SUBJECTS.filter(
    (s) => hasMath || s.id !== 'math' || state.goals.some((g) => g.subject === 'math' && g.target > 0)
  )

  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '各科目标与差距'),
      el('div', { class: 'card__actions' }, [
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          onClick: () => {
            const total = summary.target || 320
            const suggestion = suggestTargets(total, state.profile.subjectSet)
            for (const item of suggestion) {
              if (item.target > 0 || hasMath) setGoal({ subject: item.subject, target: item.target })
            }
            toast('已按总分比例拆解到各科，可再手动微调', { kind: 'ok' })
            ctx.refresh()
          }
        }, '按总分自动拆解'),
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          onClick: () => setTotalDialog(ctx, summary)
        }, '设定总分目标')
      ])
    ])
  )

  /* 总分进度 */
  if (summary.target) {
    const percent = (summary.current / summary.target) * 100
    card.append(
      el('div', { class: 'stack', style: { marginBottom: '1rem' } }, [
        el('div', { class: 'row row--between' }, [
          el('span', { class: 'field__label' }, '总分进度'),
          el('span', { class: 'num', style: { fontWeight: '800' } }, `${summary.current} / ${summary.target}（还差 ${summary.gap}）`)
        ]),
        progressBar(percent, { label: '总分进度' })
      ])
    )
  }

  if (!state.goals.length) {
    card.append(emptyState(EMPTY_HINTS.goals, '按总分自动拆解', () => {
      const suggestion = suggestTargets(320, state.profile.subjectSet)
      for (const item of suggestion) if (item.target > 0) setGoal({ subject: item.subject, target: item.target })
      toast('已按 320 分示例总分拆解，请改成你的真实目标', { kind: 'ok' })
      ctx.refresh()
    }))
    return card
  }

  const list = el('div', { class: 'stack' })
  for (const subject of activeSubjects) {
    const goal = state.goals.find((g) => g.subject === subject.id) || {
      subject: subject.id,
      target: 0,
      current: 0,
      full: subject.id === 'english' || subject.id === 'politics' ? 100 : 150
    }
    const percent = goal.target ? (goal.current / goal.target) * 100 : 0
    const gap = Math.max(goal.target - goal.current, 0)

    const targetInput = el('input', {
      class: 'input score-input num',
      type: 'number',
      min: '0',
      max: String(goal.full),
      value: String(goal.target),
      'aria-label': `${subject.name}目标分`
    })
    const currentInput = el('input', {
      class: 'input score-input num',
      type: 'number',
      min: '0',
      max: String(goal.full),
      value: String(goal.current),
      'aria-label': `${subject.name}当前估分`
    })
    const commit = () => {
      setGoal({
        subject: subject.id,
        target: Number(targetInput.value) || 0,
        current: Number(currentInput.value) || 0,
        full: goal.full
      })
      ctx.refresh()
    }
    targetInput.addEventListener('change', commit)
    currentInput.addEventListener('change', commit)

    list.append(
      el('div', { class: 'card card--flat', style: { padding: '0.875rem' } }, [
        el('div', { class: 'row row--between' }, [
          el('div', { class: 'row' }, [
            el('span', { class: `tag tag--${subject.tone}` }, subject.name),
            el('span', { class: 'dim-2', style: { fontSize: '0.75rem' } }, `满分 ${goal.full}`)
          ]),
          gap > 0
            ? el('span', { class: 'tag tag--warn' }, `还差 ${gap} 分`)
            : goal.target
              ? el('span', { class: 'tag tag--done' }, '已达标')
              : null
        ]),
        el('div', { class: 'row', style: { marginTop: '0.625rem', gap: '0.5rem' } }, [
          el('span', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, '目标'),
          targetInput,
          el('span', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, '当前估分'),
          currentInput
        ]),
        el('div', { class: 'quest-progress', style: { marginTop: '0.625rem' } }, [
          progressBar(percent, { thin: true, label: `${subject.name}进度` }),
          el('span', { class: 'num' }, `${goal.target ? Math.round(percent) : 0}%`)
        ])
      ])
    )
  }
  card.append(list)

  card.append(
    el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '0.875rem', lineHeight: '1.7' } },
      '「当前估分」建议按最近一次成套真题的分数填写，每两周更新一次，差距才真实。')
  )

  return card
}

function setTotalDialog(ctx, summary) {
  const input = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '500',
    value: String(summary.target || 320)
  })
  openModal({
    title: '设定总分目标',
    body: el('div', { class: 'stack' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '目标总分'), input]),
      el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', lineHeight: '1.7' } },
        '设定后可以点「按总分自动拆解」，把总分按常见权重分到四科，再按你的实际情况微调。')
    ]),
    actions: [
      { label: '取消' },
      {
        label: '保存并拆解',
        kind: 'primary',
        onClick: () => {
          const total = Math.max(0, Number(input.value) || 0)
          const suggestion = suggestTargets(total, state.profile.subjectSet)
          for (const item of suggestion) {
            if (state.profile.subjectSet === 'no-math' && item.subject === 'math') continue
            setGoal({ subject: item.subject, target: item.target })
          }
          toast(`已按 ${total} 分拆解到各科`, { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}

/* ---------------- 分数线 ---------------- */

function referenceCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '分数线参考'),
      el('div', { class: 'card__actions' }, [
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          onClick: () => addScoreDialog(ctx)
        }, [icon('plus', { size: 15 }), '添加院校数据']),
        el('button', {
          class: 'btn btn--sm btn--ghost',
          type: 'button',
          onClick: () => { showReference = !showReference; ctx.refresh() }
        }, showReference ? '收起通用参考' : '看通用参考')
      ])
    ])
  )

  /* 用户自己录入的院校数据 */
  if (state.scores.length) {
    const list = el('div', { class: 'stack' })
    for (const item of [...state.scores].sort((a, b) => b.year - a.year)) {
      list.append(
        el('div', { class: 'item' }, [
          el('div', {}, [
            el('div', { class: 'row', style: { gap: '0.5rem' } }, [
              el('span', { class: 'tag' }, `${item.year}`),
              el('span', { class: 'item__title' }, item.school),
              item.major ? el('span', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, item.major) : null
            ]),
            el('div', { class: 'item__sub' }, [
              item.total ? `总分线 ${item.total}` : '',
              item.lines?.math ? ` · 数学 ${item.lines.math}` : '',
              item.lines?.english ? ` · 英语 ${item.lines.english}` : '',
              item.lines?.politics ? ` · 政治 ${item.lines.politics}` : '',
              item.lines?.major ? ` · 专业课 ${item.lines.major}` : '',
              item.note ? ` · ${item.note}` : ''
            ].join(''))
          ]),
          el('button', {
            class: 'icon-btn icon-btn--danger',
            type: 'button',
            'aria-label': '删除',
            onClick: async () => {
              const ok = await confirmDialog({ title: '删除这条分数线？', message: `${item.year} ${item.school}`, confirmLabel: '删除', danger: true })
              if (!ok) return
              removeScoreLine(item.id)
              toast('已删除', { kind: 'info', iconName: 'trash' })
              ctx.refresh()
            }
          }, icon('trash'))
        ])
      )
    }
    card.append(list)
  } else {
    card.append(
      el('div', { class: 'empty' }, [
        EMPTY_HINTS.scores,
        el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '0.4rem' } },
          '建议去目标院校研究生院官网查近三年的复试基本分数线，比任何第三方的数据都准。')
      ])
    )
  }

  /* 通用参考（默认收起，避免误导） */
  if (showReference) {
    const list = el('div', { class: 'stack', style: { marginTop: '1rem' } })
    for (const ref of SCORE_REFERENCES) {
      list.append(
        el('div', { class: 'card card--flat', style: { padding: '0.875rem' } }, [
          el('div', { class: 'row row--between' }, [
            el('span', { style: { fontWeight: '700', fontSize: '0.9375rem' } }, ref.label),
            el('span', { class: 'num', style: { fontWeight: '800' } }, `约 ${ref.total}`)
          ]),
          el('div', { class: 'item__sub', style: { marginTop: '0.25rem' } },
            Object.entries(ref.lines)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${subjectById(k).name} ${v}`)
              .join(' · ')),
          ref.note ? el('div', { class: 'item__sub' }, ref.note) : null
        ])
      )
    }
    card.append(
      el('div', { class: 'field', style: { marginTop: '1rem' } }, [
        el('span', { class: 'field__label' }, '通用参考（示例数据，务必以官网为准）'),
        list
      ])
    )
  }

  return card
}

function addScoreDialog(ctx) {
  const yearInput = el('input', { class: 'input', type: 'number', min: '2000', max: '2100', value: String(new Date().getFullYear()) })
  const schoolInput = el('input', { class: 'input', placeholder: '院校名称' })
  const majorInput = el('input', { class: 'input', placeholder: '专业（可留空）' })
  const totalInput = el('input', { class: 'input', type: 'number', min: '0', max: '500', placeholder: '总分线' })
  const lineInputs = {}
  for (const subject of SUBJECTS) {
    lineInputs[subject.id] = el('input', { class: 'input', type: 'number', min: '0', max: '200', placeholder: '—' })
  }
  const noteInput = el('input', { class: 'input', placeholder: '备注（可留空）' })

  openModal({
    title: '添加院校分数线',
    body: el('div', { class: 'stack' }, [
      el('div', { class: 'grid-auto' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '年份'), yearInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '院校'), schoolInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '专业'), majorInput])
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '总分线'), totalInput]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, '单科线（没有就留空）'),
        el('div', { class: 'grid-auto' },
          SUBJECTS.map((s) => el('label', { class: 'field' }, [
            el('span', { class: 'field__label' }, s.name),
            lineInputs[s.id]
          ]))
        )
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '备注'), noteInput])
    ]),
    actions: [
      { label: '取消' },
      {
        label: '保存',
        kind: 'primary',
        onClick: () => {
          if (!schoolInput.value.trim()) {
            toast('院校名称不能为空', { kind: 'error' })
            return false
          }
          const lines = {}
          for (const [key, input] of Object.entries(lineInputs)) {
            if (Number(input.value) > 0) lines[key] = Number(input.value)
          }
          addScoreLine({
            year: Number(yearInput.value) || new Date().getFullYear(),
            school: schoolInput.value.trim(),
            major: majorInput.value.trim(),
            total: Number(totalInput.value) || 0,
            lines,
            note: noteInput.value.trim()
          })
          toast('已添加', { kind: 'ok' })
          ctx.refresh()
        }
      }
    ]
  })
}
