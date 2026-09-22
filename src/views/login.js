/**
 * 视图 0：进入作战本部（登录 / 注册 / 忘记密码 / 设置新密码）
 * ------------------------------------------------------------------
 * 这是唯一一个**不套在主外壳里**的视图：没有侧栏、没有页脚、没有导航。
 * 理由很直接 —— 还没证明自己是谁的时候，导航上的每一项都点不动，
 * 摆在那里只会让人以为网站坏了。所以这一屏只做一件事：放人进来。
 *
 * 四个步骤（同一块面板里的四种形态，不跳页、不弹窗）：
 *   login   邮箱 + 密码 → 进去
 *   signup  邮箱 + 密码 + 再输一次 → 建号
 *   forgot  只填邮箱 → 发一封重置邮件
 *   reset   从邮件链接回来 → 设置新密码
 *
 * 为什么重置密码要单独一个步骤，而不是「忘记密码就发个登录链接」：
 * 登录链接只能证明「你有这个邮箱」，改不了密码。用户真正的诉求是
 * 「我忘了密码，想重新设一个」，所以这里走 Supabase 的 recovery 流程：
 * 邮件里点回来 → 临时会话 → 设置新密码 → 用新密码重新登录。
 *
 * 视觉上这一屏是整页唯一的天空：左边是这场作战本身（倒计时 + 阶段长条），
 * 右边是一块**事务局窗口**（白纸黑字、直角、顶部一条饰带）。
 * 刻意不做成「渐变背景 + 居中白卡」那套通用登录页 —— 见 DESIGN.md。
 */

import { el, examCountdown, formatDateCN, daysBetween } from '../lib/utils.js'
import { state, PHASE_TEMPLATE } from '../lib/store.js'
import { icon, brandMark } from '../components/icons.js'
import { toast } from '../components/ui.js'
import {
  isCloudConfigured,
  currentUser,
  passwordRecovery,
  signInWithPassword,
  signUpWithPassword,
  signInWithEmail,
  resetPasswordForEmail,
  updatePassword,
  resendConfirmEmail,
  signOut,
  cloudConfig
} from '../lib/cloud.js'

/** 四个步骤的 hash，同时就是可收藏、可前进后退的地址 */
export const AUTH_ROUTES = ['login', 'signup', 'forgot', 'reset']

/**
 * 登录成功的那一刻要通知外面「可以装外壳了」。
 * 用回调而不是返回 Promise：这一屏可能在应用启动前就画出来，
 * 而启动流程本身是异步的，回调更直白。
 */
let onEntered = () => {}
export function setAuthEnteredHandler(fn) {
  onEntered = typeof fn === 'function' ? fn : () => {}
}

function callEntered(user) {
  try {
    onEntered(user)
  } catch (err) {
    console.error('[login] 进入应用的钩子出错', err)
  }
}

/** 注册成功但需要先去邮箱点确认链接：这几个字要活过一次重绘 */
let carryNote = ''

/** 上一屏用户填过的邮箱：切步骤时带过去，不用重打一遍 */
let lastEmail = ''

export function renderLogin(ctx) {
  const mode = AUTH_ROUTES.includes(ctx.route) ? ctx.route : passwordRecovery() ? 'reset' : 'login'
  const note = carryNote
  carryNote = ''

  const content =
    mode === 'reset'
      ? resetPanel(ctx)
      : mode === 'forgot'
        ? forgotPanel(ctx)
        : mode === 'signup'
          ? signupPanel(ctx)
          : loginPanel(ctx)

  return el('div', { class: 'auth', dataset: { mode } }, [
    authBackdrop(),
    el('div', { class: 'auth__inner' }, [briefing(), accessDesk(content, mode, note)])
  ])
}

/**
 * 天空层。复用主站那套 `.bg-*`（天顶渐变 + 天光 + 斜射光柱 + 云带 + 细网格），
 * 但光柱压到两条：登录页要让人一眼找到输入框，不是来看风景的。
 */
function authBackdrop() {
  const layer = el('div', { class: 'auth__sky', 'aria-hidden': 'true' })
  layer.append(
    el('div', { class: 'bg-sky' }),
    el('div', { class: 'bg-bloom bg-bloom--sun' }),
    el('div', { class: 'bg-ray', style: { left: '12%' } }),
    el('div', { class: 'bg-ray bg-ray--2', style: { left: '56%' } }),
    el('div', { class: 'bg-hatch' }),
    el('div', { class: 'bg-cloud' })
  )
  return layer
}

/* ---------------- 左栏：这场作战本身 ---------------- */

function briefing() {
  const cd = examCountdown(state.profile.examDate)
  const total = Math.max(daysBetween(new Date(), state.profile.examDate), 1)
  // 走完多少：按「从今天到初试」的总天数反推，和首页口径一致
  const walked = Math.min(Math.max(Math.round(((460 - cd.days) / 460) * 100), 0), 100)

  const label = el(
    'p',
    { class: 'auth-mission__label' },
    `距 28 考研初试（${formatDateCN(state.profile.examDate, false)}）还有`
  )

  const num = el('div', { class: 'auth-mission__num num' }, [
    el('span', {}, String(cd.days)),
    el('span', { class: 'countdown__unit' }, '天')
  ])

  // 光环：和首页同一枚签名图形，只是小一号
  const halo = el('div', {
    class: 'halo auth-mission__halo',
    style: { width: '150px', height: '150px', left: '4.5rem', top: '46%', marginLeft: '-75px', marginTop: '-75px' }
  })

  const countdown = el('div', { class: 'auth-mission__count' }, [halo, label, num])

  return el('section', { class: 'auth-mission' }, [
    el('div', {}, [
      el('div', { class: 'auth-brand' }, [
        brandMark(38),
        el('div', {}, [
          el('p', { class: 'auth-brand__title' }, state.profile.siteName || '基沃托斯作战本部'),
          el('p', { class: 'auth-brand__sub' }, '28 考研 · 学园事务局')
        ])
      ]),
      countdown
    ]),
    el('div', { class: 'auth-mission__foot' }, [
      el('p', { class: 'auth-mission__meta' }, `全程 ${total} 天 · 已走过 ${walked}%`),
      phaseStrip(walked)
    ])
  ])
}

/**
 * 阶段长条：四段按 PHASE_TEMPLATE 的比例分宽，走过的部分填实。
 * 这是左栏里唯一一处「图形即信息」，也在提醒用户：这站是按阶段排计划的。
 */
function phaseStrip(walked) {
  const strip = el('div', { class: 'auth-phases', 'aria-hidden': 'true' })
  for (const tpl of PHASE_TEMPLATE) {
    strip.append(
      el('span', {
        class: 'auth-phases__seg',
        style: {
          flex: String(tpl.ratio),
          background: tpl.color,
          opacity: walked >= 100 ? '1' : '0.42'
        }
      })
    )
  }
  const fill = el('span', { class: 'auth-phases__fill', style: { width: `${walked}%` } })
  return el('div', { class: 'auth-phases__track' }, [strip, fill])
}

/* ---------------- 右栏：事务局窗口 ---------------- */

/**
 * 面板外壳。顶部那条斜杠饰带是主站的区块分隔符，
 * 这里用来交代「这是一张从事务局窗口递出来的表」。
 */
function accessDesk(content, mode, note) {
  return el('section', { class: 'auth-desk rise', dataset: { mode } }, [
    el('div', { class: 'auth-desk__strap' }, [el('span', { class: 'strap' })]),
    el('div', { class: 'auth-desk__body' }, [
      note ? el('p', { class: 'auth-note', role: 'status' }, note) : null,
      content
    ])
  ])
}

function panelHead(title, sub) {
  return el('header', { class: 'auth-head' }, [
    el('h1', { class: 'auth-head__title' }, title),
    el('p', { class: 'auth-head__sub' }, sub)
  ])
}

/* ---------------- 步骤 1：登录 ---------------- */

function loginPanel(ctx) {
  const email = field('邮箱', {
    type: 'email',
    name: 'email',
    autocomplete: 'email',
    placeholder: 'you@example.com',
    value: lastEmail,
    testid: 'auth-email'
  })
  const password = field('密码', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    placeholder: '你的密码',
    reveal: true,
    testid: 'auth-password'
  })

  const form = authForm({
    testid: 'auth-login-form',
    fields: [email, password],
    submitLabel: '登录',
    onSubmit: async () => {
      const mail = email.input.value.trim()
      const pass = password.input.value
      if (!mail) throw invalid(email, '请填邮箱')
      if (!pass) throw invalid(password, '请填密码')
      lastEmail = mail
      await signInWithPassword(mail, pass)
      const user = await currentUser()
      if (!user) throw invalid(password, '登录没有成功，请再试一次')
      entered(user, '登录成功')
    },
    footer: el('div', { class: 'auth-links' }, [
      el('button', { class: 'auth-link', type: 'button', onClick: () => ctx.go('forgot') }, '忘记密码'),
      el('button', { class: 'auth-link', type: 'button', onClick: () => ctx.go('signup') }, '还没有账号？去注册')
    ])
  })

  return el('div', { class: 'auth-panel' }, [
    panelHead('进入作战本部', '用邮箱和密码登录，你的委托与专注记录会在设备之间自动同步。'),
    form.node,
    magicLinkBlock(ctx)
  ])
}

/**
 * 免密码登录链接。
 * 这是原来设置页里的主路径，保留下来做备选：忘了密码又不想重置、或邮箱收确认信有问题时，
 * 它是最省事的入口。放在密码表单下面，因为它不该抢主按钮的位置。
 */
function magicLinkBlock(ctx) {
  const button = el('button', {
    class: 'auth-link',
    type: 'button',
    dataset: { testid: 'auth-magic-link' },
    onClick: async () => {
      const emailInput = document.querySelector('[data-testid="auth-email"]')
      const mail = (emailInput?.value || lastEmail).trim()
      if (!mail) {
        toast('先在上面填好邮箱，再发登录链接', { kind: 'info' })
        emailInput?.focus()
        return
      }
      const original = button.textContent
      button.disabled = true
      button.textContent = '正在发送…'
      try {
        lastEmail = mail
        await signInWithEmail(mail)
        toast('登录链接已发出，去邮箱点一下（没收到就看垃圾邮件）', { kind: 'ok', ms: 7000 })
      } catch (err) {
        toast(err.message, { kind: 'error', ms: 6000 })
      } finally {
        button.disabled = false
        button.textContent = original
      }
    }
  }, '不发密码，改用邮箱登录链接')

  return el('div', { class: 'auth-alt' }, [
    el('button', {
      class: 'auth-link',
      type: 'button',
      dataset: { testid: 'auth-resend' },
      onClick: async () => {
        const mail = (document.querySelector('[data-testid="auth-email"]')?.value || lastEmail).trim()
        if (!mail) {
          toast('先在上面填好邮箱', { kind: 'info' })
          return
        }
        try {
          await resendConfirmEmail(mail)
          toast('确认邮件已重发，点邮件里的链接就能登录了', { kind: 'ok', ms: 7000 })
        } catch (err) {
          toast(err.message, { kind: 'error', ms: 6000 })
        }
      }
    }, '注册后一直没收到确认邮件？重发一封'),
    button
  ])
}

/* ---------------- 步骤 2：注册 ---------------- */

function signupPanel(ctx) {
  const email = field('邮箱', {
    type: 'email',
    name: 'email',
    autocomplete: 'email',
    placeholder: 'you@example.com',
    value: lastEmail,
    testid: 'auth-email'
  })
  const password = field('密码', {
    type: 'password',
    name: 'new-password',
    autocomplete: 'new-password',
    placeholder: '至少 6 位',
    hint: '至少 6 位。建议用一句只有你自己记得住的话，别用生日。',
    reveal: true,
    testid: 'auth-password'
  })
  const again = field('再输一次密码', {
    type: 'password',
    name: 'confirm-password',
    autocomplete: 'new-password',
    placeholder: '和上面保持一致',
    reveal: true,
    testid: 'auth-password-again'
  })

  const form = authForm({
    testid: 'auth-signup-form',
    fields: [email, password, again],
    submitLabel: '注册并开始',
    onSubmit: async () => {
      const mail = email.input.value.trim()
      const pass = password.input.value
      if (!mail) throw invalid(email, '请填邮箱')
      if (pass.length < 6) throw invalid(password, '密码至少 6 位')
      if (pass !== again.input.value) throw invalid(again, '两次输入的密码不一样')
      lastEmail = mail
      const { needsConfirm } = await signUpWithPassword(mail, pass)
      if (needsConfirm) {
        // 项目开着「Confirm email」：注册完还不能直接进，必须先去邮箱点确认链接
        carryNote = `账号已建好。去 ${mail} 收一封确认邮件，点里面的链接激活，然后回来登录。`
        ctx.go('login')
        return
      }
      const user = await currentUser()
      if (!user) throw invalid(email, '注册没有成功，请再试一次')
      entered(user, '账号已建好，欢迎')
    },
    footer: el('div', { class: 'auth-links' }, [
      el('button', { class: 'auth-link', type: 'button', onClick: () => ctx.go('login') }, '已经有账号了？去登录')
    ])
  })

  return el('div', { class: 'auth-panel' }, [
    panelHead('注册一个新账号', '一个邮箱一个账号。数据存在你自己的账号下，别人看不到。'),
    form.node
  ])
}

/* ---------------- 步骤 3：忘记密码 ---------------- */

function forgotPanel(ctx) {
  const email = field('注册时用的邮箱', {
    type: 'email',
    name: 'email',
    autocomplete: 'email',
    placeholder: 'you@example.com',
    value: lastEmail,
    testid: 'auth-email'
  })

  const form = authForm({
    testid: 'auth-forgot-form',
    fields: [email],
    submitLabel: '发重置密码邮件',
    onSubmit: async () => {
      const mail = email.input.value.trim()
      if (!mail) throw invalid(email, '请填邮箱')
      lastEmail = mail
      await resetPasswordForEmail(mail)
      carryNote = `重置邮件已发往 ${mail}。点邮件里的链接回到本站，就能设置新密码了。没收到的话，先看看垃圾邮件。`
      ctx.go('login')
    },
    footer: el('div', { class: 'auth-links' }, [
      el('button', { class: 'auth-link', type: 'button', onClick: () => ctx.go('login') }, '想起来了，回去登录')
    ])
  })

  return el('div', { class: 'auth-panel' }, [
    panelHead('重置密码', '填注册时用的邮箱，我们会发一封带链接的邮件。'),
    form.node,
    el('p', { class: 'auth-hint' },
      '邮件里点回来之后会直接进入「设置新密码」这一步，不用输旧密码。' +
      '链接只能用一次；如果提示失效，回到这里重发一封就行。')
  ])
}

/* ---------------- 步骤 4：从邮件链接回来，设置新密码 ---------------- */

function resetPanel(ctx) {
  const password = field('新密码', {
    type: 'password',
    name: 'new-password',
    autocomplete: 'new-password',
    placeholder: '至少 6 位',
    reveal: true,
    testid: 'auth-new-password'
  })
  const again = field('再输一次新密码', {
    type: 'password',
    name: 'confirm-password',
    autocomplete: 'new-password',
    placeholder: '和上面保持一致',
    reveal: true,
    testid: 'auth-password-again'
  })

  const form = authForm({
    testid: 'auth-reset-form',
    fields: [password, again],
    submitLabel: '设置新密码',
    onSubmit: async () => {
      const pass = password.input.value
      if (pass.length < 6) throw invalid(password, '密码至少 6 位')
      if (pass !== again.input.value) throw invalid(again, '两次输入的密码不一样')
      await updatePassword(pass)
      /**
       * 改完就退出这个临时会话，回到登录页。
       *
       * 为什么不直接放人进去：改密码用的会话是邮件链接换来的，它是为了「改密码」而存在的，
       * 不是用户主动登录的结果。让用户拿新密码正式登一次，才能确认「新密码真的记住了」——
       * 否则一旦新密码在别处输错，用户会以为网站坏了。
       */
      carryNote = '新密码已生效，用新密码登录一次就可以开工了。'
      await signOut()
      ctx.go('login')
    },
    footer: el('div', { class: 'auth-links' }, [
      el('button', {
        class: 'auth-link',
        type: 'button',
        onClick: async () => {
          await signOut()
          ctx.go('login')
        }
      }, '先不改了，回去登录')
    ])
  })

  return el('div', { class: 'auth-panel' }, [
    panelHead('设置新密码', '邮件链接已确认，设一个新密码就可以重新登录了。'),
    form.node
  ])
}

/* ---------------- 表单零件 ---------------- */

/**
 * 一个输入框。
 * 返回 { node, input, error }：error 是挂在输入框下面的行内报错位，
 * 用 aria-describedby 关联，屏幕阅读器会念出来。
 */
function field(label, opts = {}) {
  const id = `auth-${opts.name || label}-${Math.random().toString(36).slice(2, 7)}`
  const input = el('input', {
    class: 'input',
    id,
    type: opts.type || 'text',
    name: opts.name || '',
    autocomplete: opts.autocomplete || 'off',
    placeholder: opts.placeholder || '',
    spellcheck: 'false',
    'aria-describedby': '',
    dataset: opts.testid ? { testid: opts.testid } : {}
  })
  if (opts.value) input.value = opts.value

  const error = el('p', { class: 'auth-field__error', id: `${id}-error`, hidden: true })
  const hint = opts.hint ? el('p', { class: 'auth-field__hint' }, opts.hint) : null

  const described = [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ')
  input.setAttribute('aria-describedby', described)
  if (hint) hint.id = `${id}-hint`

  const body = el('div', { class: 'auth-field__body' }, [input])

  if (opts.reveal) {
    // 睁眼 / 闭眼两个图标都在 DOM 里，只切显隐 —— 换 innerHTML 会丢掉焦点位置
    const open = icon('eye', { size: 18 })
    const shut = icon('eyeOff', { size: 18 })
    shut.hidden = true
    const toggle = el('button', {
      class: 'auth-field__peek',
      type: 'button',
      'aria-label': '显示密码',
      'aria-pressed': 'false',
      title: '显示密码',
      onClick: () => {
        const revealed = input.type === 'text'
        input.type = revealed ? 'password' : 'text'
        open.hidden = !revealed
        shut.hidden = revealed
        toggle.setAttribute('aria-pressed', String(!revealed))
        toggle.setAttribute('aria-label', revealed ? '显示密码' : '隐藏密码')
        toggle.title = revealed ? '显示密码' : '隐藏密码'
        input.focus()
      }
    }, [open, shut])
    body.append(toggle)
    body.classList.add('auth-field__body--with-peek')
  }

  const node = el('div', { class: 'auth-field' }, [
    el('label', { class: 'auth-field__label', for: id }, label),
    body,
    hint,
    error
  ])

  return {
    node,
    input,
    error,
    setError(message) {
      if (!message) {
        error.hidden = true
        error.textContent = ''
        input.removeAttribute('aria-invalid')
        return
      }
      error.textContent = message
      error.hidden = false
      input.setAttribute('aria-invalid', 'true')
    }
  }
}

/** 校验失败：把错误挂在对应字段上，并让外层知道该停下来了 */
function invalid(fieldRef, message) {
  const err = new Error(message)
  err.field = fieldRef
  err.expected = true
  return err
}

/**
 * 表单外壳：字段 + 主按钮 + 一行说明 + 底部链接。
 *
 * 提交时的三件事：
 *   1. 先清掉上一次的报错；
 *   2. 按钮进入 loading（禁用 + 换字），防止连点造成重复注册 / 重复发信；
 *   3. 失败把英文报错翻成人话，落在「表单级」提示区（网络、邮件额度这类不属于某个字段）。
 */
function authForm({ fields, submitLabel, onSubmit, footer, testid }) {
  const feedback = el('p', { class: 'auth-feedback', role: 'alert', hidden: true })

  const button = el('button', {
    class: 'btn btn--primary auth-submit',
    type: 'submit',
    dataset: { testid: testid ? `${testid}-submit` : 'auth-submit' }
  }, submitLabel)

  const form = el('form', {
    class: 'auth-form',
    novalidate: true,
    dataset: testid ? { testid } : {},
    onSubmit: async (event) => {
      event.preventDefault()
      if (button.disabled) return
      for (const f of fields) f.setError('')
      feedback.hidden = true
      feedback.textContent = ''

      const original = button.textContent
      button.disabled = true
      button.textContent = '请稍候…'
      // 提交期间整张表只读，避免用户改了值却发现按的是旧值
      for (const f of fields) f.input.readOnly = true

      try {
        await onSubmit()
      } catch (err) {
        if (err?.field) {
          err.field.setError(err.message)
          err.field.input.focus()
        } else {
          feedback.textContent = err?.message || '出了点问题，请再试一次'
          feedback.hidden = false
        }
      } finally {
        for (const f of fields) f.input.readOnly = false
        button.disabled = false
        button.textContent = original
      }
    }
  })

  form.append(feedback, ...fields.map((f) => f.node), button, footer)
  return { node: form, button }
}

/** 登录成功：交给外面的钩子去装主应用 */
function entered(user, message) {
  toast(`${message}${user?.email ? ` · ${user.email}` : ''}`, { kind: 'ok', iconName: 'cloud' })
  callEntered(user)
}

/* ---------------- 应用启动前的等待屏 ---------------- */

/**
 * 正在读会话时显示的东西。
 * 用不着 spinner —— 会话读取通常几十毫秒，一闪而过的转圈比空白更烦人。
 */
export function renderAuthLoading() {
  return el('div', { class: 'auth auth--loading' }, [
    authBackdrop(),
    el('div', { class: 'auth__inner' }, [
      el('div', { class: 'auth-wait' }, [
        brandMark(44),
        el('p', { class: 'auth-wait__text' }, '正在确认登录状态…')
      ])
    ])
  ])
}

/* ---------------- 后端没配好时的兜底 ---------------- */

/**
 * 没配置后端时**不应该**走到这里（那种情况下应用会照旧跑成本地版）。
 * 留着这一屏是为了应对一种极端情况：配置在会话中途被清掉了。
 */
export function renderAuthNoBackend() {
  return el('div', { class: 'auth auth--bare' }, [
    authBackdrop(),
    el('div', { class: 'auth__inner' }, [
      el('div', { class: 'auth-desk rise' }, [
        el('div', { class: 'auth-desk__strap' }, [el('span', { class: 'strap' })]),
        el('div', { class: 'auth-desk__body' }, [
          panelHead('云端没有配置', '这一份构建里没有找到后端地址，登录暂时用不了。'),
          el('p', { class: 'auth-hint' },
            '如果你是自己部署的：把 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 写进 .env 后重新构建，' +
            '或在浏览器控制台里清掉 kivotos-kaoyan-cloud-cfg-v1 再刷新。'),
          el('div', { class: 'auth-links' }, [
            el('button', {
              class: 'btn btn--sm',
              type: 'button',
              onClick: () => location.reload()
            }, '重新加载'),
            el('button', {
              class: 'btn btn--sm btn--ghost',
              type: 'button',
              onClick: () => {
                try {
                  localStorage.removeItem('kivotos-kaoyan-cloud-cfg-v1')
                } catch {
                  /* 忽略 */
                }
                location.reload()
              }
            }, '清掉本机配置并重新加载')
          ])
        ])
      ])
    ])
  ])
}

/* ---------------- 给测试和外部用的小工具 ---------------- */

/** 当前配置指向哪个项目（只显示域名，不显示 key） */
export function authProjectHost() {
  try {
    return new URL(cloudConfig().url).host
  } catch {
    return ''
  }
}

/** 退出登录后回到这一屏（设置页的「退出登录」用） */
export async function leaveToAuth() {
  await signOut()
  location.hash = 'login'
}
