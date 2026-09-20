/**
 * 视图 3：阶段计划
 * 三件事：① 生成四阶段时间表 ② 导入教材目录 ③ 把目录排进每天
 */

import { el, formatDateCN, toDateKey, addDays, formatMinutes, examCountdown } from '../lib/utils.js'
import {
  state,
  generatePhases,
  currentPhase,
  phaseProgress,
  scheduleChapters,
  removeChapter,
  setChapterDone,
  subjectName,
  SUBJECTS,
  todayKey
} from '../lib/store.js'
import { parseOutline, defaultOutlineFor, MATH_SCOPE } from '../data/syllabus.js'
import { icon } from '../components/icons.js'
import { emptyState, progressBar, toast, openModal, confirmDialog } from '../components/ui.js'
import { isAiReady, buildPlanPrompt, requestPlan, applyAiPlan } from '../lib/ai.js'
import { EMPTY_HINTS } from '../data/dialogues.js'

export function renderPlan(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })

  wrap.append(headerCard(ctx))
  wrap.append(phasesCard(ctx))
  wrap.append(outlineCard(ctx))

  return wrap
}

/* ---------------- 顶部：概览 + 生成 ---------------- */

function headerCard(ctx) {
  const cd = examCountdown(state.profile.examDate)
  const card = el('section', { class: 'card rise' })
  card.append(
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { class: 'section-title' }, '阶段计划'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          `从今天到 ${formatDateCN(state.profile.examDate, false)}，还剩 ${cd.days} 天`)
      ]),
      el('div', { class: 'row' }, [
        el(
          'button',
          { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => doGenerate(ctx) },
          [icon('refresh', { size: 15 }), state.phases.length ? '重排四个阶段' : '生成阶段计划']
        )
      ])
    ])
  )
  card.append(
    el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.875rem', lineHeight: '1.75' } },
      '四个阶段按剩余天数自动按比例划分：基础期先把教材过一遍，强化期刷题归纳，冲刺期成套真题，模考期稳节奏。' +
      '它只是骨架——具体每天做什么，由下面的教材目录填进去。')
  )
  return card
}

async function doGenerate(ctx) {
  const ok = await confirmDialog({
    title: state.phases.length ? '重排四个阶段？' : '生成阶段计划？',
    message: state.phases.length
      ? '会按今天到考试日的剩余天数重新划分四个阶段，已有的教材目录和委托不受影响。'
      : '会按剩余天数把备考期划成基础、强化、冲刺、模考四段。之后可以随时重排。',
    confirmLabel: '生成'
  })
  if (!ok) return
  generatePhases(new Date(), state.profile.examDate)
  toast('阶段计划已生成', { kind: 'ok', iconName: 'plan' })
  ctx.refresh()
}

/* ---------------- 四个阶段时间轴 ---------------- */

function phasesCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  card.append(el('div', { class: 'card__head' }, [el('h2', { class: 'section-title' }, '四阶段时间表')]))

  if (!state.phases.length) {
    card.append(emptyState('还没有阶段计划。点上面的按钮生成一次，四段时间表立刻出来。', '生成阶段计划', () => doGenerate(ctx)))
    return card
  }

  const active = currentPhase()
  const list = el('div', { class: 'phase-list' })
  for (const phase of state.phases) {
    const pp = phaseProgress(phase)
    const isActive = active && active.id === phase.id
    list.append(
      el('div', {
        class: 'phase',
        dataset: { active: String(Boolean(isActive)) },
        style: { '--phase-color': phase.color }
      }, [
        el('div', { class: 'phase__bar' }),
        el('div', {}, [
          el('div', { class: 'row' }, [
            el('span', { class: 'phase__name' }, phase.name),
            isActive ? el('span', { class: 'tag' }, '进行中') : null
          ]),
          el('div', { class: 'phase__goal' }, phase.goal),
          el('div', { class: 'phase__dates' }, `${formatDateCN(phase.start, false)} → ${formatDateCN(phase.end, false)} · 共 ${pp.total} 天`),
          el('div', { style: { marginTop: '0.5rem', maxWidth: '420px' } }, [progressBar(pp.percent, { thin: true })])
        ]),
        el('div', { class: 'phase__stat' }, [
          el('div', { class: 'phase__pct' }, `${pp.percent}%`),
          el('div', {}, pp.left > 0 ? `剩 ${pp.left} 天` : '已结束')
        ])
      ])
    )
  }
  card.append(list)

  card.append(
    el('div', { class: 'row', style: { marginTop: '1rem' } }, [
      el(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          onClick: () => {
            const text = state.phases
              .map((p) => `${p.name}：${p.start} → ${p.end}（${p.goal}）`)
              .join('\n')
            navigator.clipboard?.writeText(text).then(
              () => toast('阶段时间表已复制', { kind: 'ok' }),
              () => toast('复制失败，请手动选择文本', { kind: 'error' })
            )
          }
        },
        '复制时间表'
      )
    ])
  )
  return card
}

/* ---------------- 教材目录 ---------------- */

function outlineCard(ctx) {
  const card = el('section', { class: 'card rise', dataset: { reveal: '' } })
  card.append(
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'section-title' }, '教材目录与排期'),
      el('div', { class: 'card__actions' }, [
        el(
          'button',
          { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => importOutlineDialog(ctx) },
          [icon('upload', { size: 15 }), '导入目录']
        )
      ])
    ])
  )

  const groups = SUBJECTS.map((s) => ({ subject: s, items: state.chapters.filter((c) => c.subject === s.id) }))
  const total = state.chapters.length
  const done = state.chapters.filter((c) => c.done).length

  if (!total) {
    card.append(emptyState(EMPTY_HINTS.chapters, '导入第一份目录', () => importOutlineDialog(ctx)))
    return card
  }

  card.append(
    el('div', { class: 'quest-progress', style: { marginBottom: '1rem' } }, [
      progressBar((done / total) * 100, { label: '章节完成度' }),
      el('span', { class: 'num' }, `${done}/${total}`)
    ])
  )

  for (const group of groups) {
    if (!group.items.length) continue
    const books = new Map()
    for (const item of group.items) {
      if (!books.has(item.book)) books.set(item.book, [])
      books.get(item.book).push(item)
    }
    const block = el('div', { class: 'stack', style: { marginBottom: '1rem' } })
    block.append(
      el('div', { class: 'row' }, [
        el('span', { class: `tag tag--${group.subject.tone}` }, group.subject.name),
        el('span', { class: 'dim', style: { fontSize: '0.8125rem' } },
          `${group.items.length} 章 · 预计 ${formatMinutes(group.items.reduce((s, c) => s + c.hours * 60, 0))}`)
      ])
    )
    for (const [book, items] of books) {
      const bookWrap = el('div', { class: 'card card--flat', style: { padding: '0.875rem' } })
      const bookDone = items.filter((i) => i.done).length
      bookWrap.append(
        el('div', { class: 'row row--between' }, [
          el('div', {}, [
            el('div', { style: { fontWeight: '800' } }, book),
            el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } }, `${bookDone}/${items.length} 章完成`)
          ]),
          el(
            'button',
            {
              class: 'icon-btn icon-btn--danger',
              type: 'button',
              'aria-label': `删除《${book}》的全部章节`,
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `删除《${book}》？`,
                  message: `会删掉这本书的 ${items.length} 个章节，以及由它们生成的委托。`,
                  confirmLabel: '删除',
                  danger: true
                })
                if (!ok) return
                for (const item of items) removeChapter(item.id)
                toast('已删除', { kind: 'info', iconName: 'trash' })
                ctx.refresh()
              }
            },
            icon('trash')
          )
        ])
      )
      const chList = el('div', { style: { marginTop: '0.5rem' } })
      for (const chapter of items) {
        chList.append(
          el('div', { class: 'row', style: { padding: '0.25rem 0', gap: '0.5rem' } }, [
            el('input', {
              class: 'quest__check',
              type: 'checkbox',
              checked: chapter.done,
              'aria-label': `标记「${chapter.title}」完成`,
              style: { width: '20px', height: '20px' },
              onChange: () => {
                setChapterDone(chapter.id, !chapter.done)
                ctx.refresh()
              }
            }),
            el('span', {
              style: {
                flex: '1',
                fontSize: '0.875rem',
                textDecoration: chapter.done ? 'line-through' : 'none',
                color: chapter.done ? 'var(--text-tertiary)' : 'inherit'
              }
            }, chapter.title),
            el('span', { class: 'dim-2 mono' }, `${chapter.hours}h`)
          ])
        )
      }
      bookWrap.append(chList)
      block.append(bookWrap)
    }
    card.append(block)
  }

  return card
}

/* ---------------- 导入目录弹窗 ---------------- */

export function importOutlineDialog(ctx) {
  const mathScope = MATH_SCOPE[state.profile.subjectSet] || MATH_SCOPE.math1
  let subject = 'math'
  let useTemplate = true

  const bookInput = el('input', { class: 'input', placeholder: '教材名称，例如：高等数学（同济版）上册' })
  const textarea = el('textarea', {
    class: 'textarea',
    placeholder: '一行一章，可以带时长：\n第一章 函数与极限 | 8\n1.2 数列的极限, 6h\n- 行列式（5 小时）'
  })
  const preview = el('div', { class: 'stack', style: { maxHeight: '240px', overflow: 'auto' } })
  const dayInfo = el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } })
  let parsed = []

  const subjectRow = el('div', { class: 'row' })
  for (const s of SUBJECTS) {
    subjectRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(s.id === subject),
        onClick: (event) => {
          subject = s.id
          subjectRow.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'))
          event.currentTarget.setAttribute('aria-pressed', 'true')
          refreshPreview()
        }
      }, s.name)
    )
  }

  const templateBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true' }, '用内置目录模板')
  templateBtn.addEventListener('click', () => {
    useTemplate = !useTemplate
    templateBtn.setAttribute('aria-pressed', String(useTemplate))
    refreshPreview()
  })

  function collectTemplate() {
    const groups = defaultOutlineFor(subject, state.profile.subjectSet)
    const out = []
    for (const group of groups) {
      for (const [title, hours] of group.chapters) out.push({ title: `${group.book} · ${title}`, hours })
    }
    return out
  }

  function refreshPreview() {
    parsed = useTemplate ? collectTemplate() : parseOutline(textarea.value)
    const totalHours = parsed.reduce((s, c) => s + c.hours, 0)
    const cd = examCountdown(state.profile.examDate)
    const perDay = parsed.length ? Math.ceil(parsed.length / Math.max(cd.days, 1)) : 0
    dayInfo.textContent = parsed.length
      ? `共 ${parsed.length} 章 · 预计 ${formatMinutes(totalHours)} · 按剩余 ${cd.days} 天排，平均每天约 ${perDay} 章`
      : '没有解析出章节。试试一行一章的写法。'
    preview.replaceChildren()
    preview.append(
      el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } },
        parsed.length ? '前几章预览：' : ''),
      ...parsed.slice(0, 8).map((c) =>
        el('div', { class: 'row', style: { fontSize: '0.8125rem' } }, [
          el('span', { style: { flex: '1' } }, c.title),
          el('span', { class: 'dim-2 mono' }, `${c.hours}h`)
        ])
      ),
      parsed.length > 8 ? el('div', { class: 'dim-2', style: { fontSize: '0.75rem' } }, `…还有 ${parsed.length - 8} 章`) : null
    )
  }

  textarea.addEventListener('input', () => {
    if (useTemplate) return
    refreshPreview()
  })

  const aiBtn = el('button', { class: 'btn btn--sm', type: 'button' }, [
    icon('ai', { size: 15 }),
    isAiReady() ? '让 AI 估算时长' : 'AI（未配置）'
  ])
  aiBtn.addEventListener('click', async () => {
    if (!isAiReady()) {
      toast('先在「设置 → AI 接口」里填好接口，或直接导入（不配也能用）', { kind: 'info', iconName: 'ai' })
      return
    }
    const chapters = useTemplate ? collectTemplate() : parseOutline(textarea.value)
    if (!chapters.length) {
      toast('先要有章节内容才能估算', { kind: 'error' })
      return
    }
    aiBtn.disabled = true
    aiBtn.textContent = 'AI 正在估算…'
    try {
      const cd = examCountdown(state.profile.examDate)
      const prompt = buildPlanPrompt({
        subject,
        book: bookInput.value || subjectName(subject),
        chapters,
        startDate: todayKey(),
        examDate: state.profile.examDate,
        daysLeft: cd.days
      })
      const plan = await requestPlan({ prompt })
      const applied = applyAiPlan(plan, {
        subject,
        book: bookInput.value || subjectName(subject),
        chapters,
        startDate: todayKey()
      })
      parsed = applied.chapters
      modal.close()
      showAiResultDialog(applied, ctx)
    } catch (err) {
      toast(`AI 调用失败：${err.message}`, { kind: 'error', ms: 5000 })
    } finally {
      aiBtn.disabled = false
      aiBtn.replaceChildren(icon('ai', { size: 15 }), document.createTextNode('让 AI 估算时长'))
    }
  })

  const form = el('div', { class: 'stack' }, [
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '科目'), subjectRow]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '教材名称'), bookInput]),
    el('div', { class: 'row' }, [templateBtn]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label' }, '或者粘贴你的目录（一行一章）'),
      textarea
    ]),
    el('div', { class: 'row' }, [
      el('label', { class: 'btn btn--sm', style: { cursor: 'pointer' } }, [
        icon('upload', { size: 15 }),
        '选择文件（.txt / .md / .csv）',
        el('input', {
          type: 'file',
          accept: '.txt,.md,.csv,text/plain',
          style: { display: 'none' },
          onChange: async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            textarea.value = await file.text()
            useTemplate = false
            templateBtn.setAttribute('aria-pressed', 'false')
            if (!bookInput.value) bookInput.value = file.name.replace(/\.[^.]+$/, '')
            refreshPreview()
          }
        })
      ]),
      aiBtn
    ]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '解析结果'), preview]),
    dayInfo
  ])

  refreshPreview()

  const modal = openModal({
    title: '导入教材目录',
    body: form,
    actions: [
      { label: '取消' },
      {
        label: '排进日程',
        kind: 'primary',
        onClick: () => {
          const chapters = useTemplate ? collectTemplate() : parseOutline(textarea.value)
          if (!chapters.length) {
            toast('没有可导入的章节', { kind: 'error' })
            return false
          }
          const result = scheduleChapters({
            subject,
            book: bookInput.value || subjectName(subject),
            chapters,
            startDate: todayKey(),
            examDate: state.profile.examDate
          })
          toast(`已排入 ${result.created} 条委托，覆盖 ${formatMinutes(result.totalHours * 60)}`, { kind: 'ok', iconName: 'check' })
          ctx.refresh()
        }
      }
    ]
  })
  return modal
}

/** AI 返回结果确认框：先给用户看一眼策略，再决定要不要采纳 */
function showAiResultDialog(applied, ctx) {
  const body = el('div', { class: 'stack' }, [
    applied.summary ? el('div', { class: 'speech speech--arona', style: { padding: '0.875rem' } }, [
      el('span', { class: 'speech__who' }, 'AI 建议的策略'),
      el('div', { style: { fontSize: '0.9375rem' } }, applied.summary)
    ]) : null,
    el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, `共 ${applied.chapters.length} 章，已按时长估算调整`),
    el('div', { class: 'stack', style: { maxHeight: '236px', overflow: 'auto' } },
      applied.chapters.slice(0, 20).map((c) =>
        el('div', { class: 'row', style: { fontSize: '0.8125rem', gap: '0.5rem' } }, [
          c.priority === 'high' ? el('span', { class: 'tag tag--error' }, '重点') : null,
          c.priority === 'low' ? el('span', { class: 'tag' }, '次要') : null,
          el('span', { style: { flex: '1' } }, c.title),
          el('span', { class: 'dim-2 mono' }, `${c.hours}h`)
        ])
      )
    ),
    applied.milestones?.length
      ? el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, '建议里程碑'),
          el('div', { class: 'stack' }, applied.milestones.slice(0, 6).map((m) =>
            el('div', { class: 'dim', style: { fontSize: '0.8125rem' } }, `${m.date} · ${m.what}`)
          ))
        ])
      : null
  ])

  openModal({
    title: 'AI 排期结果',
    body,
    actions: [
      { label: '不采纳' },
      {
        label: '采纳并排进日程',
        kind: 'primary',
        onClick: () => {
          const result = scheduleChapters({
            subject: applied.subject,
            book: applied.book,
            chapters: applied.chapters,
            startDate: applied.startDate,
            examDate: state.profile.examDate
          })
          toast(`已排入 ${result.created} 条委托`, { kind: 'ok', iconName: 'check' })
          ctx.refresh()
        }
      }
    ]
  })
}
