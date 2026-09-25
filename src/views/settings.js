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
  STORAGE_KEY,
  examSession,
  setStudyStartDate
} from '../lib/store.js'
import { icon } from '../components/icons.js'
import { toast, openModal, confirmDialog } from '../components/ui.js'
import { NONCOMMERCIAL_NOTICE, CHARACTER_NOTICE, SPINE_NOTICE } from '../components/footer.js'
import { setAuthNotice } from './login.js'
import { CHARACTERS, resetCustomImageCache } from '../components/characters.js'
import { isAiReady, aiConfig } from '../lib/ai.js'
import { MATH_SCOPE } from '../data/syllabus.js'
import {
  cloudConfig,
  saveCloudConfig,
  isCloudConfigured,
  currentUser,
  watchSession,
  onCloudStatus,
  cloudStatus,
  cloudMeta,
  signOut,
  clearCloudConfig,
  runSync,
  pullCloud,
  forcePush,
  forcePull,
  deleteCloudData,
  isStateEmpty,
  CLOUD_TABLE
} from '../lib/cloud.js'

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
  wrap.append(cloudCard(ctx))
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

  // 届数实时预览：改初试日期时立刻显示会变成哪一届
  const sessionHint = el('div', {
    class: 'dim-2',
    style: { fontSize: '0.75rem', marginTop: '0.25rem' }
  }, sessionHintText(state.profile.examDate))

  const startInput = el('input', {
    class: 'input',
    type: 'date',
    value: state.profile.studyStartDate || ''
  })
  startInput.addEventListener('change', () => {
    setStudyStartDate(startInput.value)
    toast('备考起点已更新，首页的「已走过 x%」会跟着变', { kind: 'ok' })
    ctx.refresh()
  })

  nicknameInput.addEventListener('change', () => { updateProfile({ nickname: nicknameInput.value.trim() || 'Sensei' }); toast('已保存', { kind: 'ok' }); ctx.refresh() })
  siteInput.addEventListener('change', () => { updateProfile({ siteName: siteInput.value.trim() || '基沃托斯作战本部' }); toast('已保存', { kind: 'ok' }); ctx.refresh() })
  dateInput.addEventListener('change', () => {
    const next = dateInput.value || state.profile.examDate
    updateProfile({ examDate: next })
    sessionHint.textContent = sessionHintText(next)
    toast(`初试日期已更新，届数与倒计时都跟着变了：${sessionTitleOf(next)}`, { kind: 'ok', ms: 3500 })
    ctx.refresh()
  })
  setSelect.addEventListener('change', () => { updateProfile({ subjectSet: setSelect.value }); toast('已切换', { kind: 'ok' }); ctx.refresh() })
  goalInput.addEventListener('change', () => { updateProfile({ dailyGoalMin: Math.max(30, Number(goalInput.value) || 360) }); toast('已保存', { kind: 'ok' }); ctx.refresh() })

  card.body.append(
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '称呼'), nicknameInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '站点名称'), siteInput]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label' }, '初试日期'),
        dateInput,
        sessionHint
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label' }, '备考起点'),
        startInput,
        el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '0.25rem' } },
          '首次设置时自动记为当天，用于首页算「已走过 x%」。留空则不显示百分比。')
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '数学科目'), setSelect]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, '每日目标（分钟）'), goalInput])
    ]),
    el('div', { class: 'dim-2', style: { fontSize: '0.75rem', marginTop: '0.75rem', lineHeight: '1.7' } },
      `当前按「${MATH_SCOPE[state.profile.subjectSet]?.name || '数学一'}」安排计划：${MATH_SCOPE[state.profile.subjectSet]?.note || ''}`)
  )
  return card.node
}

/** 初试日期下方的届数提示文案 */
function sessionHintText(examDate) {
  const exam = examSession(examDate)
  return `按这个日期，站点会显示为「${exam.title}」（${exam.year} 年 12 月初试 → ${exam.year + 1} 年入学）`
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

/* ---------------- 云端同步（路径 2：Supabase） ---------------- */

/**
 * 上一次界面已经画过的用户 id。
 * 放在模块作用域：跨重绘记住身份，避免同一个人重复触发重绘。
 */
let renderedUserId = ''

/**
 * 这张卡片是「真正的后端」在界面上的全部入口。
 * 三种状态各自渲染一套 UI：
 *   ① 还没配置 Supabase  → 粘贴项目地址 + anon key（附建表 SQL 的说明）
 *   ② 配置好了但没登录   → 一个「去登录」按钮，真正的表单在登录屏上
 *   ③ 已登录             → 立即同步、保留哪一边、退出、删除云端数据
 *
 * ② 为什么不在卡片里再放一套表单：登录页现在是独立的一屏（views/login.js），
 * 那里有忘记密码、显示密码、行内校验这些必须有的东西。设置页再放一份精简版，
 * 等于同一个流程两处实现 —— 迟早会出现「这边能改密码、那边不能」的分叉。
 */
function cloudCard(ctx) {
  const card = sectionCard('云端同步（可选后端）', 'cloud')

  const statusNode = el('span', { class: 'cloud-status', dataset: { state: 'idle', testid: 'cloud-status' } }, [
    el('i', { class: 'cloud-status__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'cloud-status__text' }, isCloudConfigured() ? '检查登录状态…' : '未配置')
  ])
  card.body.append(statusNode)

  const slot = el('div', { class: 'stack', style: { marginTop: '0.9rem' } })
  card.body.append(slot)

  const paint = () => {
    const status = cloudStatus()
    // 只有「同步过程中」和「刚同步完」才让运行时状态盖过登录状态，
    // 否则一直显示 idle 的「未配置」会很误导。
    const showRuntime = status.state !== 'idle' || !isCloudConfigured()
    statusNode.dataset.state = showRuntime ? status.state : 'off'
    statusNode.querySelector('.cloud-status__text').textContent = showRuntime
      ? status.message || (isCloudConfigured() ? '已配置' : '未配置')
      : '未登录'
  }
  paint()
  /**
   * 订阅清理。
   * 注意两个坑：
   *   1) ctx 上没有 onDestroy（那是视图自己用的），这里必须注册到 viewDestroyers 里；
   *   2) 订阅是异步建立的（要等 SDK 加载），所以先同步登记一个清理函数，
   *      等 Promise 落地后把真正的退订塞进去。
   */
  const teardown = new Set()
  ctx.onDestroy?.(() => {
    for (const fn of teardown) {
      try {
        fn()
      } catch (err) {
        console.warn('[settings] 云端订阅清理失败', err)
      }
    }
    teardown.clear()
  })

  const track = (maybePromise) => {
    if (typeof maybePromise === 'function') {
      teardown.add(maybePromise)
      return
    }
    if (maybePromise?.then) {
      maybePromise
        .then((fn) => {
          if (typeof fn === 'function') teardown.add(fn)
        })
        .catch(() => {})
    }
  }

  // 状态变化只在设置页活着的时候反馈，切走就退订
  track(onCloudStatus(paint))

  /**
   * 登录身份变化时才重绘。
   *
   * 这里必须用 watchSession（身份去重），不能直接订阅 SDK 的认证事件：
   * SDK 每次订阅都会立刻派发一次 INITIAL_SESSION，而这个视图每重绘一次
   * 就会重新订阅一次 —— 无脑 refresh 会变成「重绘 → 订阅 → 事件 → 重绘」
   * 的自激循环，按钮每 40ms 被摘掉重建，用户根本点不中。
   */
  let paintedUserId = renderedUserId
  track(
    watchSession((user) => {
      const id = user?.id || ''
      if (id === paintedUserId) return
      paintedUserId = id
      renderedUserId = id
      ctx.refresh()
    })
  )

  if (!isCloudConfigured()) {
    slot.append(setupForm(ctx))
  } else {
    // currentUser() 是异步的（要读会话、可能刷新 token），先渲染配置摘要，
    // 拿到用户之后再决定插登录表单还是账号面板
    const accountSlot = el('div', { class: 'stack' })
    slot.append(cfgSummary(ctx), accountSlot)
    let cancelled = false
    teardown.add(() => {
      cancelled = true
    })
    currentUser().then(async (user) => {
      if (cancelled) return
      accountSlot.append(user ? await accountPanel(ctx, user) : loginPrompt(ctx))
    })
  }
  return card.node
}

/** ① 还没配置：让用户把 Supabase 项目的两串值粘进来 */
function setupForm(ctx) {
  const urlInput = el('input', {
    class: 'input',
    placeholder: 'https://abcdefghijklmn.supabase.co',
    spellcheck: 'false',
    autocomplete: 'off',
    dataset: { testid: 'cloud-url' }
  })
  const keyInput = el('input', {
    class: 'input',
    placeholder: 'eyJhbGciOi…（anon public key）',
    spellcheck: 'false',
    autocomplete: 'off',
    dataset: { testid: 'cloud-anon' }
  })

  const hint = el('div', { class: 'dim-2', style: { fontSize: '0.75rem', lineHeight: '1.7' } },
    '这两项在 Supabase 控制台 → Project Settings → API 里，分别是 Project URL 和 anon public key。' +
    'anon key 本来就是给浏览器用的公开信息，真正的安全边界是数据库的行级安全（RLS）。')

  const save = el('button', {
    class: 'btn btn--sm btn--primary',
    type: 'button',
    dataset: { testid: 'cloud-save-config' },
    onClick: () => {
      const result = saveCloudConfig({ url: urlInput.value, anonKey: keyInput.value })
      if (!result.ok) {
        toast(result.message, { kind: 'error', ms: 5200 })
        return
      }
      // 顺手把数据层的回显字段也写上，导出备份时能看出「这份数据属于哪个项目」
      updateSettings({ supabaseUrl: cloudConfig().url, supabaseAnon: '' })
      toast('已保存，接着用邮箱登录即可', { kind: 'ok' })
      ctx.refresh()
    }
  }, [icon('check', { size: 15 }), '保存项目配置'])

  return el('div', { class: 'stack', dataset: { testid: 'cloud-config-form' } }, [
    el('div', { class: 'grid-auto' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, 'Project URL'), urlInput]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label' }, 'anon public key'), keyInput])
    ]),
    hint,
    el('div', { class: 'row' }, [
      save,
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        onClick: () => setupGuide()
      }, '怎么申请？看这里')
    ])
  ])
}

/** 配置摘要（已配置时显示） */
function cfgSummary(ctx) {
  const cfg = cloudConfig()
  const meta = cloudMeta()
  /**
   * 构建期烘焙进来的配置是不允许在界面上改的（整站就指向这一个项目）。
   * 所以这时候只显示「后端地址 + 上次同步时间」，不给「改配置」按钮 ——
   * 点了也没用（env 优先于本地存储），留着只会让人以为能改。
   * 本机自己填的配置（fromEnv 为假）仍然可以清掉重填。
   */
  const locked = Boolean(cfg.fromEnv)
  return el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } }, [
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('div', { style: { minWidth: '0' } }, [
        el('div', { class: 'mono', style: { fontSize: '0.75rem', wordBreak: 'break-all' } }, cfg.url),
        el('div', { class: 'dim-2', style: { fontSize: '0.6875rem', marginTop: '0.2rem' } },
          meta.lastSyncedAt
            ? `上次同步：${new Date(meta.lastSyncedAt).toLocaleString('zh-CN')}（${meta.lastSyncedBy === 'push' ? '上传' : '下载'}）`
            : `数据表：${CLOUD_TABLE}`),
        locked
          ? el('div', { class: 'dim-2', style: { fontSize: '0.6875rem', marginTop: '0.2rem' } },
              '后端由本站固定提供，无需（也无法）自行配置')
          : null
      ]),
      locked
        ? null
        : el('button', {
            class: 'btn btn--sm btn--ghost',
            type: 'button',
            onClick: (event) => {
              event.preventDefault()
              clearCloudConfigAndReload(ctx)
            }
          }, '改配置')
    ])
  ])
}

function clearCloudConfigAndReload(ctx) {
  clearCloudConfig()
  updateSettings({ supabaseUrl: '', supabaseAnon: '' })
  toast('已清除云端配置（本地数据不受影响）', { kind: 'info' })
  ctx.refresh()
}

/**
 * ② 已配置、未登录。
 *
 * 正常流程下走不到这里 —— 没登录的人根本进不了应用，看到的是登录屏。
 * 留着这套是为了兜住两种边角情况：会话在设置页停留期间失效（被别的标签页退出、
 * 或 refresh token 过期），以及直接手敲 `#settings` 掉进来的旧书签。
 * 两种情况都只需要一句话 + 一个把人送去登录屏的按钮。
 */
function loginPrompt(ctx) {
  return el('div', { class: 'stack', dataset: { testid: 'cloud-login' } }, [
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('div', {}, [
        el('div', { style: { fontWeight: '700' } }, '当前未登录'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', marginTop: '0.15rem' } },
          '登录之后，这份数据会在你的设备之间自动同步。')
      ]),
      el('button', {
        class: 'btn btn--sm btn--primary',
        type: 'button',
        dataset: { testid: 'cloud-go-login' },
        onClick: () => {
          location.hash = 'login'
        }
      }, [icon('arrowRight', { size: 15 }), '去登录'])
    ])
  ])
}

/** ③ 已登录：账号面板 */
async function accountPanel(ctx, user) {
  const meta = cloudMeta()
  const autoTemplate = state.settings.cloud?.autoPush !== false

  const auto = el('button', {
    class: 'chip',
    type: 'button',
    'aria-pressed': String(autoTemplate),
    dataset: { testid: 'cloud-auto-toggle' },
    onClick: () => {
      const next = state.settings.cloud?.autoPush === false
      updateSettings({ cloud: { autoPush: next } })
      toast(next ? '已开启自动同步' : '已关闭自动同步（仍可手动同步）', { kind: 'info' })
      ctx.refresh()
    }
  }, autoTemplate ? '自动同步：开' : '自动同步：关')

  const syncButton = el('button', {
    class: 'btn btn--sm btn--primary',
    type: 'button',
    dataset: { testid: 'cloud-sync-now' },
    onClick: async (event) => {
      const button = event.currentTarget
      const original = button.textContent
      button.disabled = true
      button.textContent = '同步中…'
      try {
        const result = await runSync({})
        if (result.action === 'conflict') {
          button.disabled = false
          button.textContent = original
          openConflictDialog(ctx)
          return
        }
        toast(result.ok ? `同步完成：${result.message}` : result.message, {
          kind: result.ok ? 'ok' : 'error',
          ms: result.ok ? 2600 : 6000
        })
      } finally {
        button.disabled = false
        button.textContent = original
        ctx.refresh()
      }
    }
  }, [icon('refresh', { size: 15 }), '立即同步'])

  const panel = el('div', { class: 'stack', dataset: { testid: 'cloud-account' } }, [
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('div', {}, [
        el('div', { style: { fontWeight: '700' } }, user.email || '已登录'),
        el('div', { class: 'dim-2 mono', style: { fontSize: '0.6875rem' } }, `user_id ${user.id}`)
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn--sm btn--ghost',
          type: 'button',
          onClick: async () => {
            // 先把话写好再退出：退出之后界面立刻被登录屏接管，
            // 那时再弹 toast 会被渲染冲掉，或者和别的提示叠在一起。
            setAuthNotice('已退出登录。本机的数据都还在，用原账号登录就能继续。')
            await signOut()
            toast('已退出登录，本地数据还在', { kind: 'info' })
            ctx.refresh()
          }
        }, '退出登录'),
        el('button', {
          class: 'btn btn--sm btn--danger',
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: '删除云端数据？',
              message: '只会删掉服务器上那一行，你本机浏览器里的数据不受影响。',
              confirmLabel: '删除云端数据',
              danger: true
            })
            if (!ok) return
            try {
              await deleteCloudData()
              toast('云端数据已删除', { kind: 'ok' })
            } catch (err) {
              toast(err.message, { kind: 'error', ms: 6000 })
            }
            ctx.refresh()
          }
        }, '删除云端数据')
      ])
    ]),
    el('div', { class: 'row' }, [syncButton, auto]),
    el('div', { class: 'dim-2', style: { fontSize: '0.75rem', lineHeight: '1.7' } },
      meta.initialized
        ? '改动会在 2～3 秒后自动上传；在另一台设备登录后会自动拉取。'
        : '还没做过首次同步 —— 点一次「立即同步」，它会问你要保留哪一边。')
  ])

  // 首次同步必须先确认方向，否则会把用户几个月的数据悄悄覆盖掉
  if (!meta.initialized) {
    panel.append(
      el('div', { class: 'btn-row-actions' }, [
        el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          dataset: { testid: 'cloud-first-sync' },
          onClick: () => openFirstSyncDialog(ctx)
        }, '确认首次同步方向')
      ])
    )
  }
  return panel
}

/** 「这份数据以谁为准」——唯一一个会覆盖数据的弹窗，所以写清楚后果 */
function openFirstSyncDialog(ctx) {
  const localEmpty = isStateEmpty(state)
  const pick = async (direction, button) => {
    button.disabled = true
    const original = button.textContent
    button.textContent = '处理中…'
    try {
      const result = direction === 'pull' ? await forcePull() : await forcePush()
      if (result.ok) {
        toast(direction === 'pull' ? '已把云端数据拉到本机' : '已把本机数据上传到云端', { kind: 'ok' })
        modal.close()
        ctx.refresh()
      } else {
        toast(result.message, { kind: 'error', ms: 6000 })
        button.disabled = false
        button.textContent = original
      }
    } catch (err) {
      toast(err.message, { kind: 'error', ms: 6000 })
      button.disabled = false
      button.textContent = original
    }
  }

  const uploadButton = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    dataset: { testid: 'cloud-keep-local' },
    onClick: (event) => pick('push', event.currentTarget)
  }, localEmpty ? '把本机数据上传（本机基本是空的）' : '保留本机数据，上传覆盖云端')

  const downloadButton = el('button', {
    class: 'btn',
    type: 'button',
    dataset: { testid: 'cloud-keep-remote' },
    onClick: (event) => pick('pull', event.currentTarget)
  }, '保留云端数据，下载覆盖本机')

  const modal = openModal({
    title: '首次同步：用哪边的数据？',
    body: el('div', { class: 'stack', style: { fontSize: '0.875rem', lineHeight: '1.8' } }, [
      el('p', { class: 'dim' },
        '云端和本机各有一份数据。第一次连接必须选一边，被覆盖的那边救不回来 —— 所以这一步永远问你，不替你决定。'),
      el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } }, [
        el('div', { style: { fontWeight: '700' } }, `本机：${localEmpty ? '基本没有数据' : '有数据'}`),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } },
          `委托 ${state.quests.length} · 专注 ${state.focus.length} 条 · 章节 ${state.chapters.length} · 错题 ${state.mistakes.length}`),
        el('div', { style: { marginTop: '0.5rem', fontWeight: '700' } }, '云端'),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } },
          '点下面的按钮时才会去读云端内容；如果云端还是空的，选「保留本机」就对了。')
      ]),
      el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } },
        '拿不准就先点「取消」，去「数据与迁移」里导出一份备份，再回来做这一步。'),
      // 两个大按钮放在正文里（窄屏更好点），弹窗底部的按钮复用同一批节点
      el('div', { class: 'btn-row-actions' }, [uploadButton, downloadButton])
    ]),
    actions: [
      { label: '取消', onClick: () => false },
      { label: '保留云端，下载覆盖本机', onClick: () => downloadButton.click(), close: false },
      { label: '保留本机，上传覆盖云端', kind: 'primary', onClick: () => uploadButton.click(), close: false }
    ]
  })
  return modal
}

/** 两边都改了：不猜，让用户选，而且把两边的内容摆出来给他看 */
function openConflictDialog(ctx) {
  /** 一行摘要，让用户看得见自己选的是什么 */
  const summarize = (label, payload, when) => {
    const wrap = el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } })
    if (!payload) {
      wrap.append(
        el('div', { style: { fontWeight: '700' } }, label),
        el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } }, '（云端暂时读不到，可能是网络问题）')
      )
      return wrap
    }
    const quests = Array.isArray(payload.quests) ? payload.quests : []
    const done = quests.filter((q) => q.done).length
    const focus = Array.isArray(payload.focus) ? payload.focus : []
    const minutes = focus.reduce((sum, f) => sum + (Number(f.minutes) || 0), 0)
    wrap.append(
      el('div', { style: { fontWeight: '700' } }, label),
      el('div', { class: 'dim-2', style: { fontSize: '0.8125rem', lineHeight: '1.7' } }, [
        el('div', {}, `委托 ${quests.length} 条（完成 ${done}）· 专注 ${focus.length} 次 / ${Math.round(minutes / 60)} 小时`),
        el('div', {}, `章节 ${(payload.chapters || []).length} · 错题 ${(payload.mistakes || []).length} · 目标 ${(payload.goals || []).length}`),
        el('div', { class: 'mono', style: { fontSize: '0.6875rem', marginTop: '0.2rem' } },
          when ? `云端更新时间：${new Date(when).toLocaleString('zh-CN')}` : '')
      ])
    )
    return wrap
  }

  const remoteSlot = el('div', {}, summarize('云端', null))
  const body = el('div', { class: 'stack', style: { fontSize: '0.875rem', lineHeight: '1.8' } }, [
    el('p', { class: 'dim' },
      '本机和云端在上次同步之后都被改过，所以不能靠时间戳自动决定 —— 选一边，另一边会被覆盖。'),
    summarize('本机', state),
    remoteSlot,
    el('div', { class: 'dim-2', style: { fontSize: '0.8125rem' } },
      '建议：先选「本机覆盖云端」（保住你手上这份），再去另一台设备上重新拉取。' +
      '想要两边都不丢，可以先在「数据与迁移」里分别导出两份备份。')
  ])

  // 顺手把云端那份读出来显示（失败就显示读不到，不影响用户继续选）
  pullCloud()
    .then((remote) => {
      if (remote.hasRemote) remoteSlot.replaceChildren(summarize('云端', remote.payload, remote.updatedAt))
    })
    .catch(() => {})

  return openModal({
    title: '两边都有新改动',
    body,
    actions: [
      { label: '稍后再说', onClick: () => false },
      {
        label: '本机覆盖云端',
        onClick: async () => {
          const result = await forcePush()
          toast(result.ok ? '已用本机数据覆盖云端' : result.message, {
            kind: result.ok ? 'ok' : 'error', ms: 5000
          })
          ctx.refresh()
        }
      },
      {
        label: '云端覆盖本机',
        kind: 'primary',
        onClick: async () => {
          const result = await forcePull()
          toast(result.ok ? '已用云端数据覆盖本机' : result.message, {
            kind: result.ok ? 'ok' : 'error', ms: 5000
          })
          ctx.refresh()
        }
      }
    ]
  })
}

/** 怎么申请一个 Supabase 项目（一步一步，照做就行） */
function setupGuide() {
  openModal({
    title: '怎么开通 Supabase（约 10 分钟，全程免费）',
    className: 'modal--wide',
    body: el('div', { class: 'stack', style: { fontSize: '0.875rem', lineHeight: '1.85' } }, [
      el('div', {}, '1. 打开 supabase.com，用 GitHub 或邮箱注册，然后 New project。'),
      el('div', {}, '2. 项目建好后进 SQL Editor → New query，把仓库里 docs/supabase-schema.sql 的内容整段粘进去 → Run。' +
        '（这一步建表 + 打开行级安全，是整个方案的关键，不做的话登录后会提示「还没有 kaoyan_data 表」。）'),
      el('div', {}, '3. 到 Project Settings → API，复制 Project URL 与 anon public key，填到上面的输入框里。'),
      el('div', {}, '4. 回到这里用邮箱登录，第一次同步时选择用哪边的数据。'),
      el('div', { class: 'card card--flat', style: { padding: '0.75rem 0.875rem' } }, [
        el('div', { style: { fontWeight: '700' } }, '几个常见坑'),
        el('div', {}, '· 只填 anon public key。service_role key 是后门钥匙，放前端等于把数据库交出去。'),
        el('div', {}, '· 免费版会在一段时间无人访问后暂停项目，回来点一下 Restore 即可，数据不会丢。'),
        el('div', {}, '· 邮件发不出去：控制台 Authentication → Providers → Email 里确认邮箱登录是开着的；' +
          '也可以关掉 "Confirm email"，让注册后直接就能登录。'),
        el('div', {}, '· 想在国内用自定义域名加速：Authentication → URL Configuration 里填自己的域名，' +
          '并把 GitHub Pages 的网址加进 Redirect URLs，否则魔法链接点回来会跳错地方。')
      ])
    ]),
    actions: [{ label: '知道了', kind: 'primary' }]
  })
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
        el('div', { style: { marginTop: '0.25rem' } }, NONCOMMERCIAL_NOTICE),
        el('div', { style: { marginTop: '0.35rem' } }, CHARACTER_NOTICE),
        el('div', { style: { marginTop: '0.35rem' } }, SPINE_NOTICE)
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
  // 浏览器地址栏配色跟着主题走，取的是 DESIGN.md 里的 --bg / --accent
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1c2b' : '#1189f9')
}
