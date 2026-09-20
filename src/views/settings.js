/**
 * 视图 8：设置
 * 考试信息、外观、AI 接口、数据导出导入与跨设备迁移。
 */

import { el, toDateKey, formatMinutes } from '../lib/utils.js'
import {
  state,
  updateProfile,
  updateSettings,
  exportJSON,
  importJSON,
  resetAll,
  stats,
  todayKey,
  STORAGE_KEY
} from '../lib/store.js'
import { icon } from '../components/icons.js'
import { toast, openModal, confirmDialog } from '../components/ui.js'
import { CHARACTERS, resetCustomImageCache } from '../components/characters.js'
import { isAiReady, aiConfig } from '../lib/ai.js'
import { MATH_SCOPE } from '../data/syllabus.js'

export function renderSettings(ctx) {
  const wrap = el('div', { class: 'stack', style: { gap: '1rem' } })

  wrap.append(
    el('section', { class: 'card rise' }, [
      el('h1', { class: 'section-title' }, '设置'),
      el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
        '所有数据都保存在你自己的浏览器里，没有账号、没有服务器。')
    ])
  )

  wrap.append(examCard(ctx))
  wrap.append(appearanceCard(ctx))
  wrap.append(aiCard(ctx))
  wrap.append(dataCard(ctx))
  wrap.append(aboutCard())

  return wrap
}

/* ---------------- 考试信息 ---------------- */

function examCard(ctx) {
  const card = sectionCard('考试与个人信息', 'target')

  const nicknameInput = el('input', { class: 'input', value: state.profile.nickname || '' })
  const siteInput = el('input', { class: 'input', value: state.profile.siteName || '' })
  const dateInput = el('input', { class: 'input', type: 'date', value: state.profile.examDate })
  const setSelect = el(
    'select',
    { class: 'select' },
    Object.entries(MATH_SCOPE).map(([key, value]) =>
      el('option', { value: key, selected: key === state.profile.subjectSet }, value.name)
    )
  )
  const goalInput = el('input', {
    class: 'input',
    type: 'number',
    min: '30',
    step: '30',
    value: String(state.profile.dailyGoalMin || 360)
  })

  nicknameInput.addEventListener('change', () => { updateProfile({ nickname: nicknameInput.value.trim() || 'Sensei' }); toast('已保存', { kind: 'ok' }); ctx.refresh() })
  siteInput.addEventListener('change', () => { updateProfile({ siteName: siteInput.value.trim() || '基沃托斯作战本部' }); toast('已保存', { kind: 'ok' }); ctx.refresh() })
  dateInput.addEventListener('change', () => {
    updateProfile({ examDate: dateInput.value || state.profile.examDate })
    toast('初试日期已更新，倒计时会立刻跟着变', { kind: 'ok' })
    ctx.refresh()
  })
  setSelect.addEventListener('change', () => { updateProfile({ subjectSet: setSelect.value }); toast('已切换', { kind: 'ok' }); ctx.refresh() })
  goalInput.addEventListener('change', () => { updateProfile({ dailyGoalMin: Math.max(30, Number(goalInput.value) || 360) }); toast('已保存', { kind: 'ok' }); ctx.refresh() })

  card.body.append(
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '称呼'), nicknameInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '站点名称'), siteInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '初试日期'), dateInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '数学科目'), setSelect]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '每日目标（分钟）'), goalInput])
    ]),
    el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '0.75rem', lineHeight: '1.7' } },
      `当前按「${MATH_SCOPE[state.profile.subjectSet]?.name || '数学一'}」安排计划：${MATH_SCOPE[state.profile.subjectSet]?.note || ''}`)
  )
  return card.node
}

/* ---------------- 外观 ---------------- */

function appearanceCard(ctx) {
  const card = sectionCard('外观与角色', 'spark')

  const themeRow = el('div', { class: 'row' }, [
    el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(state.settings.theme === 'light'),
      onClick: () => { applyTheme('light'); updateSettings({ theme: 'light' }); ctx.refresh() }
    }, [icon('sun', { size: 15 }), '浅色']),
    el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(state.settings.theme === 'dark'),
      onClick: () => { applyTheme('dark'); updateSettings({ theme: 'dark' }); ctx.refresh() }
    }, [icon('moon', { size: 15 }), '深色'])
  ])

  const mascotRow = el('div', { class: 'row' })
  for (const char of CHARACTERS) {
    const on = state.settings.mascots[char.id]
    mascotRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(Boolean(on)),
        onClick: () => {
          updateSettings({ mascots: { [char.id]: !on } })
          ctx.refresh()
        }
      }, `${char.name}${on ? '（显示）' : '（隐藏）'}`)
    )
  }

  const speechOn = state.settings.mascots.speech
  const customOn = state.settings.customCharacters
  card.body.append(
    el('div', { class: 'stack' }, [
      field('主题', themeRow),
      field('角色挂件', mascotRow),
      field('星野台词', el('div', { class: 'row' }, [
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(Boolean(speechOn)),
          onClick: () => { updateSettings({ mascots: { speech: !speechOn } }); ctx.refresh() }
        }, speechOn ? '开启（每天轮换）' : '已关闭')
      ])),
      field('自定义角色图', el('div', { class: 'row' }, [
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(Boolean(customOn)),
          onClick: () => {
            updateSettings({ customCharacters: !customOn })
            resetCustomImageCache()
            toast(
              customOn
                ? '已切回内置的自绘 Q 版形象'
                : '已开启。如果 characters/ 里没有对应图片，会把报错留在控制台（这是正常的）',
              { kind: 'info', ms: 4000 }
            )
            ctx.refresh()
          }
        }, customOn ? '使用 characters/ 里的图片' : '使用内置自绘形象'),
        el('button', {
          class: 'btn btn--sm btn--ghost',
          type: 'button',
          onClick: () => customCharacterDialog()
        }, '怎么替换？')
      ]))
    ])
  )
  return card.node
}

/** 说明怎样换成自己的角色图 */
function customCharacterDialog() {
  openModal({
    title: '换成你自己的角色图片',
    body: el('div', { class: 'stack', style: { fontSize: '0.875rem', lineHeight: '1.8' } }, [
      el('div', {}, '1. 准备三张背景透明的 PNG，建议宽高比 4:5（例如 400×500）。'),
      el('div', {}, '2. 命名为 hoshino.png（星野）、arona.png（阿洛娜）、plana.png（普拉娜）。'),
      el('div', {}, '3. 放进项目的 public/characters/ 目录。'),
      el('div', {}, '4. 跑一次「一键上线.bat」重新部署。'),
      el('div', {}, '5. 回到这里，把上面的开关切到「使用 characters/ 里的图片」。'),
      el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } }, [
        el('div', { style: { fontWeight: '700' } }, '为什么默认不开？'),
        el('div', {}, '因为请求一个不存在的文件，浏览器一定会在控制台留下 404 记录，前端没法让它静默。' +
          '默认关掉，没放图的人就完全不会产生多余请求。'),
        el('div', { style: { marginTop: '0.4rem' } },
          '另外请注意：图片会随网站一起发布到公网，请确认你有权使用它。本站为个人非商业用途。')
      ])
    ]),
    actions: [{ label: '知道了', kind: 'primary' }]
  })
}

/* ---------------- AI 接口 ---------------- */

function aiCard(ctx) {
  const card = sectionCard('AI 接口（可选）', 'ai')
  const cfg = aiConfig()

  const enabled = el('button', {
    class: 'chip',
    type: 'button',
    'aria-pressed': String(Boolean(cfg.enabled)),
    onClick: () => {
      updateSettings({ aiApi: { enabled: !cfg.enabled } })
      ctx.refresh()
    }
  }, cfg.enabled ? '已启用' : '未启用')

  const baseInput = el('input', { class: 'input', value: cfg.baseUrl || '', placeholder: 'https://api.example.com/v1' })
  const keyInput = el('input', { class: 'input', type: 'password', value: cfg.apiKey || '', placeholder: 'sk-…' })
  const modelInput = el('input', { class: 'input', value: cfg.model || '', placeholder: '例如：gpt-4o-mini / deepseek-chat' })

  const save = () => {
    updateSettings({
      aiApi: {
        baseUrl: baseInput.value.trim(),
        apiKey: keyInput.value.trim(),
        model: modelInput.value.trim()
      }
    })
    toast('已保存', { kind: 'ok' })
  }
  for (const input of [baseInput, keyInput, modelInput]) input.addEventListener('change', save)

  card.body.append(
    el('div', { class: 'stack' }, [
      field('是否启用', el('div', { class: 'row' }, [enabled])),
      el('div', { class: 'grid-auto' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '接口地址'), baseInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '模型名称'), modelInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label' }, 'API Key'), keyInput])
      ]),
      el('div', { class: 'dim-2', style: { fontSize: '0.75rem', lineHeight: '1.75' } }, [
        el('div', {}, '· 只填 OpenAI 兼容的 /v1 接口即可，请求直接从你的浏览器发往该地址，不经过任何第三方。'),
        el('div', {}, '· Key 存在本地浏览器里，换设备需要重新填；分享导出的数据时会一并带出，请注意。'),
        el('div', {}, '· 接口需要允许浏览器跨域（CORS）。如果报跨域错误，说明该服务不允许网页直接调用，换一个网关或不用 AI 也能正常排期。'),
        el('div', {}, `· 当前状态：${isAiReady() ? '已就绪，可以「让 AI 估算时长」' : '未就绪（不配置也能用内置规则排期）'}`)
      ])
    ])
  )
  return card.node
}

/* ---------------- 数据 ---------------- */

function dataCard(ctx) {
  const card = sectionCard('数据与迁移', 'cloud')
  const s = stats()

  card.body.append(
    el('div', { class: 'dim', style: { fontSize: '0.8125rem', lineHeight: '1.75' } },
      `当前数据：委托 ${s.totalQuests} 条（完成 ${s.doneQuests}）· 专注 ${formatMinutes(s.totalFocus)} · 章节 ${s.chapters} 个 · 错题 ${s.mistakes} 条 · 连续 ${s.streak} 天`),
    el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        onClick: () => {
          const blob = new Blob([exportJSON()], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = el('a', { href: url, download: `基沃托斯作战本部-备份-${toDateKey(new Date())}.json` })
          document.body.append(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          toast('已导出备份文件', { kind: 'ok', iconName: 'download' })
        }
      }, [icon('download', { size: 15 }), '导出备份']),
      el('label', { class: 'btn btn--sm', style: { cursor: 'pointer' } }, [
        icon('upload', { size: 15 }),
        '导入备份',
        el('input', {
          type: 'file',
          accept: '.json,application/json',
          style: { display: 'none' },
          onChange: async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              importJSON(await file.text())
              toast('导入成功，数据已还原', { kind: 'ok', iconName: 'check' })
              ctx.refresh()
            } catch (err) {
              toast(`导入失败：${err.message}`, { kind: 'error', ms: 5000 })
            } finally {
              event.target.value = ''
            }
          }
        })
      ]),
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        onClick: () => syncDialog(ctx)
      }, [icon('cloud', { size: 15 }), '跨设备同步'])
    ]),
    el('div', { class: 'row', style: { marginTop: '0.875rem' } }, [
      el('button', {
        class: 'btn btn--sm btn--danger',
        type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: '清空全部数据？',
            message: '委托、专注记录、错题、章节、勋章全部会删除，无法恢复。建议先导出备份。',
            confirmLabel: '我确认清空',
            danger: true
          })
          if (!ok) return
          resetAll()
          toast('已恢复初始状态', { kind: 'info' })
          ctx.refresh()
        }
      }, [icon('trash', { size: 15 }), '清空全部数据'])
    ])
  )
  return card.node
}

/** 跨设备同步：用「复制/粘贴 JSON」这种最土但最可靠的方式 */
function syncDialog(ctx) {
  const textarea = el('textarea', {
    class: 'textarea',
    placeholder: '把另一台设备上导出的 JSON 粘贴到这里，然后点「覆盖导入」'
  })
  openModal({
    title: '跨设备同步',
    body: el('div', { class: 'stack' }, [
      el('div', { class: 'dim', style: { fontSize: '0.8125rem', lineHeight: '1.75' } },
        '本站没有服务器，所以同步靠「导出 → 传过去 → 导入」三步。手机和电脑之间用微信/QQ 传文件或粘贴文本都可以。'),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, '本机数据（可复制走）'),
        el('textarea', {
          class: 'textarea',
          readonly: true,
          value: exportJSON(),
          style: { minHeight: '110px' },
          onClick: (event) => event.target.select()
        })
      ]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label' }, '要导入的数据'), textarea])
    ]),
    actions: [
      { label: '复制本机数据', onClick: () => {
          navigator.clipboard?.writeText(exportJSON()).then(
            () => toast('已复制到剪贴板', { kind: 'ok' }),
            () => toast('复制失败，请手动全选复制', { kind: 'error' })
          )
          return false
        } },
      {
        label: '覆盖导入',
        kind: 'primary',
        onClick: async () => {
          if (!textarea.value.trim()) {
            toast('先把要导入的内容粘贴进来', { kind: 'error' })
            return false
          }
          try {
            importJSON(textarea.value)
            toast('导入成功', { kind: 'ok', iconName: 'check' })
            ctx.refresh()
          } catch (err) {
            toast(`导入失败：${err.message}`, { kind: 'error', ms: 5000 })
            return false
          }
        }
      }
    ]
  })
}

/* ---------------- 关于 ---------------- */

function aboutCard() {
  const card = sectionCard('关于本站', 'book')
  card.body.append(
    el('div', { class: 'stack', style: { fontSize: '0.8125rem', lineHeight: '1.8' } }, [
      el('div', {}, '这是一个纯静态的个人备考规划站：不需要后端、不需要账号、不产生任何费用。'),
      el('div', {}, '数据默认只存在这台设备的浏览器里。清理浏览器数据会一并清掉，请定期导出备份。'),
      el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } }, [
        el('div', { style: { fontWeight: '700' } }, '用途与版权声明'),
        el('div', { style: { marginTop: '0.25rem' } }, '本站为个人备考自用的非商业网站，无广告、无收费、无任何形式的盈利。'),
        el('div', { style: { marginTop: '0.35rem' } },
          '《蔚蓝档案》及其角色（小鸟游星野、阿洛娜、普拉娜）版权归 Nexon / Yostar 所有。本站为非官方粉丝作品，站内 Q 版形象为自行绘制的原创图形，不使用官方立绘与游戏内素材。')
      ]),
      el('div', { class: 'mono dim-2', style: { fontSize: '0.6875rem' } }, `本地存储键名：${STORAGE_KEY}`)
    ])
  )
  return card.node
}

/* ---------------- 小工具 ---------------- */

function sectionCard(title, iconName) {
  const body = el('div', {})
  const node = el('section', { class: 'card rise', dataset: { reveal: '' } }, [
    el('div', { class: 'card__head' }, [
      icon(iconName, { size: 18 }),
      el('h2', { class: 'section-title' }, title)
    ]),
    body
  ])
  return { node, body }
}

function field(label, control) {
  return el('label', { class: 'field' }, [el('span', { class: 'field__label' }, label), control])
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1c2b' : '#3D9BE9')
}
