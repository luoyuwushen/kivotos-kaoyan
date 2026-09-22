/**
 * 云端同步（路径 2：真正的后端 = Supabase）
 * ------------------------------------------------------------------
 * 这个模块是**可选**的：
 *   · 没配置 / 没登录时，全站照旧跑在 localStorage 上，一行代码都不会执行；
 *   · 配置 + 登录之后，整份数据会在后台与 Supabase 的一张表同步。
 *
 * 怎么区分不同用户（这是路径 2 的核心问题）
 *   1. 用户填邮箱 → Supabase 发魔法链接（或直接邮箱+密码登录）
 *   2. 登录后浏览器拿到一个 JWT，里面带 user_id
 *   3. 之后每次读写都带这个 JWT，**表上的行级安全（RLS）策略**只放行
 *      auth.uid() = user_id 的那一行
 *   4. 所以即使有人改前端 JS 想查别人的数据，数据库这一层也会拒绝
 *   —— 安全边界在数据库，不在前端。anon key 写在前端是设计如此，不是漏洞。
 *
 * 同步协议（几句话讲清楚，避免两台设备互相对冲）
 *   · 每次成功推送成功后，记下当时的服务器时间戳 cloudMeta.lastSyncedAt
 *   · 本地再次改动 → localUpdatedAt > lastSyncedAt → 「本地更新」→ 推送
 *   · 云端 updated_at > lastSyncedAt   → 「云端更新」→ 拉取
 *   · 两个都更新 → 冲突，交给人来选（不猜、不悄悄覆盖）
 *   · 多用户之间靠 RLS 天然隔离，不存在互相污染
 *
 * SDK 是**按需加载**的：只有真的配置了云端才会 import
 * `@supabase/supabase-js`，所以没配云端的人永远不会下载那 100 多 KB。
 */

/** 深拷贝：整份数据要原样送去云端，不能带引用 */
function deepCopy(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      /* 含不可克隆的值时退回 JSON 方案 */
    }
  }
  return JSON.parse(JSON.stringify(value))
}

/** Supabase 项目配置存这里（URL + anon key 都是公开信息，真正的门锁是 RLS） */
export const CLOUD_CFG_KEY = 'kivotos-kaoyan-cloud-cfg-v1'
/** 同步状态（跟用户浏览器绑定，不参与同步本身，否则会互相打架） */
export const CLOUD_META_KEY = 'kivotos-kaoyan-cloud-meta-v1'
/** 数据库表名，和 docs/supabase-schema.sql 必须一致 */
export const CLOUD_TABLE = 'kaoyan_data'
/**
 * 登录会话在 localStorage 里的键名。
 *
 * 注意：supabase-js 对 auth.storageKey 是**整体覆盖**，不是拿项目 ref 去拼
 * （默认值才是 `sb-<项目ref>-auth-token`）。所以这里给什么，存的就是什么。
 * 显式指定有个好处：换项目地址时会话不会串到另一个项目上。
 */
export const AUTH_STORAGE_KEY = 'kivotos-kaoyan-auth'

const PUSH_DEBOUNCE_MS = 2500
/** 云端 payload 大小上限，超过就拒收（避免把 500MB 免费额度一次写满） */
const MAX_PAYLOAD_BYTES = 1024 * 1024

/* ---------------- 配置 ---------------- */

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/**
 * 构建期注入的配置（可选）。
 *
 * 优先级：构建期环境变量 > 浏览器里存的配置。
 * 这样「自己部署一份」的人可以把项目地址写进 .env 一起构建，打开站点就已经配好，
 * 不用再让每个使用者去设置页粘贴一遍。只把 anon key 写进前端是安全的 ——
 * 它是设计成公开的，真正的门锁是数据库的 RLS 策略。
 */
const ENV_URL = String(import.meta.env?.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const ENV_ANON = String(import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim()

/** 当前 Supabase 配置（没配就是空串） */
export function cloudConfig() {
  if (ENV_URL && ENV_ANON) return { url: ENV_URL, anonKey: ENV_ANON, fromEnv: true }
  const cfg = readJSON(CLOUD_CFG_KEY) || {}
  return {
    url: String(cfg.url || '').trim().replace(/\/+$/, ''),
    anonKey: String(cfg.anonKey || '').trim(),
    fromEnv: false
  }
}

/**
 * 校验配置格式。
 * project ref 只允许小写字母数字和连字符，先拦下来能省掉一大类「复制错了」的排查。
 */
export function validateConfig({ url, anonKey }) {
  const u = String(url || '').trim().replace(/\/+$/, '')
  const k = String(anonKey || '').trim()
  if (!u) return { ok: false, message: '请填写项目 URL' }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(u)) {
    return { ok: false, message: '项目 URL 形如 https://xxxxxxxx.supabase.co（注意不要带结尾斜杠和 /rest/v1）' }
  }
  if (!k) return { ok: false, message: '请填写 anon public key' }
  if (k.length < 40) return { ok: false, message: 'anon key 看起来不完整（应该是很长的字符串）' }
  if (/^sb_secret_|service_role/i.test(k)) {
    return { ok: false, message: '这是 service_role / secret key，绝对不能放在前端。请改用 anon public key。' }
  }
  return { ok: true, message: '' }
}

export function saveCloudConfig({ url, anonKey }) {
  const check = validateConfig({ url, anonKey })
  if (!check.ok) return check
  if (cloudConfig().fromEnv) {
    return { ok: false, message: '这份构建已经把 Supabase 配置写进环境变量了，浏览器里改不动。要改请改 .env 后重新构建。' }
  }
  writeJSON(CLOUD_CFG_KEY, {
    url: String(url).trim().replace(/\/+$/, ''),
    anonKey: String(anonKey).trim(),
    savedAt: new Date().toISOString()
  })
  resetClient()
  resetSessionCache()
  return { ok: true, message: '' }
}

export function clearCloudConfig() {
  localStorage.removeItem(CLOUD_CFG_KEY)
  resetClient()
  resetSessionCache()
}

/** 是否已经配置过 Supabase */
export function isCloudConfigured() {
  const cfg = cloudConfig()
  return Boolean(cfg.url && cfg.anonKey)
}

/* ---------------- 同步元信息 ---------------- */

export function cloudMeta() {
  const meta = readJSON(CLOUD_META_KEY) || {}
  return {
    userId: meta.userId || '',
    email: meta.email || '',
    initialized: Boolean(meta.initialized),
    lastSyncedAt: meta.lastSyncedAt || '',
    lastSyncedBy: meta.lastSyncedBy || ''
  }
}

export function patchCloudMeta(patch) {
  writeJSON(CLOUD_META_KEY, { ...cloudMeta(), ...patch })
}

/* ---------------- SDK 客户端 ---------------- */

let client = null
let clientKey = ''

export function resetClient() {
  client = null
  clientKey = ''
  // 客户端重建了，原来那个桥接也失效了，下次读会话时重新挂
  authBridgeBound = false
}

/**
 * 拿（必要时创建）Supabase 客户端。
 * 这里用动态 import：Vite 会把它拆成独立 chunk，没配云端的人不会加载。
 */
async function getClient() {
  const cfg = cloudConfig()
  if (!cfg.url || !cfg.anonKey) throw new Error('还没有配置 Supabase 项目')
  const key = `${cfg.url}|${cfg.anonKey}`
  if (client && clientKey === key) return client
  let createClient
  try {
    ;({ createClient } = await import('@supabase/supabase-js'))
  } catch (err) {
    throw new Error(`加载云端 SDK 失败（离线或网络被拦）：${err.message}`)
  }
  // 换过项目的人：把旧项目留下的、按项目 ref 命名的会话清掉，
  // 否则一个已经失效的 token 会一直躺在浏览器里，排查起来很费劲。
  purgeForeignSessions(cfg.url)
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // 魔法链接点回来时，URL 里带的 token 由 SDK 自动接收
      detectSessionInUrl: true,
      // PKCE 更安全：链接只能在同一台设备的同一个浏览器里兑换
      flowType: 'pkce',
      storageKey: AUTH_STORAGE_KEY
    }
  })
  clientKey = key
  return client
}

/** 清掉不属于当前项目的 sb-<ref>-auth-token / -code-verifier 残留 */
function purgeForeignSessions(url) {
  try {
    const ref = new URL(url).hostname.split('.')[0]
    const keep = new Set([AUTH_STORAGE_KEY])
    const doomed = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || keep.has(k)) continue
      if (/^sb-.+-auth-token/.test(k) && !k.startsWith(`sb-${ref}-`)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    /* 清理失败无所谓，不影响登录 */
  }
}

/** 把 SDK 抛出来的英文错误翻译成看得懂的话 */
function humanize(error, fallback = '云端操作失败') {
  if (!error) return fallback
  const raw = error.message || String(error)
  if (/relation .* does not exist|42P01|schema cache/i.test(raw)) {
    return '数据库里还没有 kaoyan_data 表 —— 请先在 Supabase 里执行建表 SQL'
  }
  if (/Invalid login credentials/i.test(raw)) return '邮箱或密码不对'
  if (/Email not confirmed/i.test(raw)) return '邮箱还没确认，请先点邮件里的确认链接（没收到就点「重发一封」）'
  if (/User already registered/i.test(raw)) return '这个邮箱已经注册过了，直接登录即可'
  if (/Password should be at least/i.test(raw)) return '密码至少 6 位'
  if (/email rate limit|over_email_send_rate_limit/i.test(raw)) {
    return '登录邮件发送太频繁了 —— Supabase 免费版每小时只允许发少量邮件，等一会儿再试，或改用「邮箱 + 密码」注册登录'
  }
  if (/Auth session missing|session_not_found|invalid claim|token has expired/i.test(raw)) {
    return '这个链接已经失效或过期了，请重新回到登录页再发一封重置邮件'
  }
  if (/same.*password|should be different from the old password/i.test(raw)) {
    return '新密码不能和旧密码一样，换一个吧'
  }
  if (/otp_disabled|Signups not allowed/i.test(raw)) {
    return '这个项目不允许用登录链接注册新账号 —— 请到 Authentication → Sign In / Providers → Email 打开「Allow new users to sign up」，或改用「邮箱 + 密码」注册'
  }
  if (/Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED/i.test(raw)) {
    return '连不上云端（检查网络，或确认项目 URL 没写错）'
  }
  return `${fallback}：${raw}`
}

/* ---------------- 会话 ---------------- */

/**
 * 会话缓存。
 *
 * 这里踩过一个坑，值得写下来：设置页每次重绘都会重新订阅 onAuthStateChange，
 * 而 SDK 在订阅时会立刻派发一次 INITIAL_SESSION —— 如果处理器无脑调用
 * ctx.refresh()，就会变成「重绘 → 订阅 → 事件 → 重绘」的自激循环，
 * 界面上表现为按钮每 40ms 被摘掉重建一次，根本点不中。
 *
 * 两条对策：
 *   1. 会话按身份缓存，只在 user_id 真的变了的时候才通知界面；
 *   2. 客户端只建一个（同一个 key 复用），避免 SDK 反复初始化。
 */
let sessionCache = { loaded: false, user: null }
let sessionInflight = null

/**
 * 「这次拿到会话，是因为点了重置密码的邮件链接」。
 *
 * 为什么要有这个旗标：重置链接点回来时，SDK 兑换完 code 会**真的建出一个会话**
 * （PASSWORD_RECOVERY 事件），跟正常登录在数据层上完全一样。如果只看「有没有用户」，
 * 界面就会在这时候把用户直接放进应用里，重置密码这一步等于被跳过了。
 * 所以这里单独记一笔：这次会话是「临时」的，只够拿来改密码，改完要重新登录。
 *
 * 消费式读取（consume）：读一次就销掉，避免下次正常打开时还停在改密码页。
 */
let recoveryMode = false
const recoveryWatchers = new Set()

/** 当前是否处于「从邮件链接回来改密码」的状态 */
export function passwordRecovery() {
  return recoveryMode
}

/**
 * 订阅重置密码状态的变化。
 * 界面上要在「邮件里点回来」的瞬间切到改密码那一步，就必须能收到这个通知 ——
 * 那一刻 user_id 是从无到有，watchSession 也会回调，但两条流的语义不同，分开更清楚。
 */
export function watchPasswordRecovery(fn) {
  recoveryWatchers.add(fn)
  try {
    fn(recoveryMode)
  } catch (err) {
    console.error('[cloud] 重置密码订阅回调出错', err)
  }
  return () => recoveryWatchers.delete(fn)
}

function setRecoveryMode(on) {
  const next = Boolean(on)
  if (recoveryMode === next) return
  recoveryMode = next
  for (const fn of recoveryWatchers) {
    try {
      fn(recoveryMode)
    } catch (err) {
      console.error('[cloud] 重置密码订阅回调出错', err)
    }
  }
}

function rememberSession(user) {
  const changed = (sessionCache.user?.id || '') !== (user?.id || '')
  sessionCache = { loaded: true, user: user || null }
  if (changed) {
    // 改密码用的临时会话一旦结束（改完了 / 退出了 / 过期了），旗标要跟着落下去，
    // 否则用户重新登录后还会被按回改密码那一页。
    if (!sessionCache.user) setRecoveryMode(false)
    for (const fn of sessionWatchers) {
      try {
        fn(sessionCache.user)
      } catch (err) {
        console.error('[cloud] 会话订阅回调出错', err)
      }
    }
  }
  return sessionCache.user
}

const sessionWatchers = new Set()

/**
 * 订阅「登录身份」变化（不是底层的 auth 事件）。
 * 只有 user_id 真的变了才会回调，所以可以安全地在每次重绘时重新注册。
 */
export function watchSession(fn) {
  sessionWatchers.add(fn)
  if (sessionCache.loaded) {
    try {
      fn(sessionCache.user)
    } catch (err) {
      console.error('[cloud] 会话订阅回调出错', err)
    }
  }
  return () => sessionWatchers.delete(fn)
}

/** 当前登录用户；未登录返回 null。带缓存，离线也不会抛错。 */
export function currentUser() {
  if (!isCloudConfigured()) return Promise.resolve(rememberSession(null))
  if (sessionInflight) return sessionInflight
  sessionInflight = (async () => {
    try {
      // 认证桥接只挂一次，且必须在读会话之前挂好，
      // 否则「用魔法链接点回来」这一次登录事件会被漏掉
      await bindAuthBridge()
      const sb = await getClient()
      const { data, error } = await sb.auth.getSession()
      if (error) return rememberSession(null)
      const user = data?.session?.user
      return rememberSession(user ? { id: user.id, email: user.email || '' } : null)
    } catch (err) {
      console.warn('[cloud] 读取会话失败', err)
      return rememberSession(null)
    } finally {
      sessionInflight = null
    }
  })()
  return sessionInflight
}

/** 配置换了以后，缓存的会话就作废了 */
export function resetSessionCache() {
  sessionCache = { loaded: false, user: null }
  sessionInflight = null
}

/** 强制重新读取一次会话（登录、退出之后调用），并把结果推给订阅者 */
export async function refreshSession() {
  sessionInflight = null
  sessionCache = { loaded: false, user: null }
  await bindAuthBridge()
  const user = await currentUser()
  // loaded=false 时 rememberSession 不一定会通知（身份可能没变），这里补一次广播
  for (const fn of sessionWatchers) {
    try {
      fn(user)
    } catch (err) {
      console.error('[cloud] 会话订阅回调出错', err)
    }
  }
  return user
}

let authBridgeBound = false

/**
 * 把 SDK 的认证事件接到会话缓存上。
 * 整个应用只桥接一次 —— 这正是「只订阅一次」的落点。
 *
 * `event` 不能丢：**只有 PASSWORD_RECOVERY 能区分「点了重置密码的邮件」和「正常登录」**。
 * PKCE 流程下链接里只有 `?code=`，类型是服务端兑换 token 时才告诉 SDK 的，
 * 所以「看 URL 上有没有 type=recovery」这条路走不通，必须读事件名。
 */
async function bindAuthBridge() {
  if (authBridgeBound || !isCloudConfigured()) return
  authBridgeBound = true
  try {
    const sb = await getClient()
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        stripAuthParamsFromUrl()
        setRecoveryMode(true)
      }
      const user = session?.user ? { id: session.user.id, email: session.user.email || '' } : null
      // 已初始化过、且身份没变 → 不进会话缓存，也就不通知任何人（避免自激）
      if (sessionCache.loaded && (sessionCache.user?.id || '') === (user?.id || '')) return
      rememberSession(user)
    })
  } catch (err) {
    authBridgeBound = false
    console.warn('[cloud] 认证桥接失败', err)
  }
}

/**
 * 清掉地址栏里的 `?code=` / `?error=` 等回跳参数。
 *
 * 为什么要主动清：登录链接点回来后地址栏会留着 `?code=xxx`，用户按一次刷新，
 * SDK 会再拿这个已经被兑换过的 code 去换一次 token，换来的是一句
 * `invalid request: both auth code and code verifier should be non-empty` —— 看起来像登录坏了，
 * 其实只是旧链接被用了第二次。改完密码那一步尤其容易触发（用户会习惯性刷新）。
 * history.replaceState 直接换掉当前历史项，不留记录、不触发 hashchange。
 */
export function stripAuthParamsFromUrl() {
  try {
    const url = new URL(location.href)
    const doomed = ['code', 'error', 'error_code', 'error_description', 'type', 'state']
    let hit = false
    for (const key of doomed) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        hit = true
      }
    }
    if (hit) history.replaceState(null, '', url.pathname + url.search + url.hash)
  } catch {
    /* 地址栏清理失败不影响任何功能 */
  }
}

/**
 * 发送魔法链接（免密码）。
 * 链接会带回本站，SDK 自动完成登录。
 *
 * 这里有个实测出来的坑：Supabase 项目如果在 Authentication 里关掉了
 * 「Allow new users to sign up」，那么 `shouldCreateUser: true` 会被直接拒绝，
 * 报 `422 otp_disabled / Signups not allowed for otp` —— 而**老用户其实是可以收链接的**。
 * 所以第一次失败时退一步用 `shouldCreateUser: false` 再试一次：
 * 已注册过的人照样能登录，没注册过的人拿到的报错也更准确。
 */
export async function signInWithEmail(email, { redirectTo } = {}) {
  const sb = await getClient()
  const target = String(email).trim()
  const options = {
    emailRedirectTo: redirectTo || location.origin + location.pathname,
    shouldCreateUser: true
  }
  const first = await sb.auth.signInWithOtp({ email: target, options })
  if (!first.error) return

  const otpDisabled = /otp_disabled|Signups not allowed/i.test(first.error.message || '')
  if (!otpDisabled) throw new Error(humanize(first.error, '发送登录链接失败'))

  const second = await sb.auth.signInWithOtp({
    email: target,
    options: { ...options, shouldCreateUser: false }
  })
  if (second.error) throw new Error(humanize(second.error, '发送登录链接失败'))
}

/**
 * 重发确认邮件。
 * 项目开着「Confirm email」时，注册完必须先点邮件里的确认链接才能用密码登录，
 * 而免费版发信额度很小，邮件丢了/没收到很常见 —— 所以界面上要能再要一封。
 */
export async function resendConfirmEmail(email, { redirectTo } = {}) {
  const sb = await getClient()
  const { error } = await sb.auth.resend({
    type: 'signup',
    email: String(email).trim(),
    options: { emailRedirectTo: redirectTo || location.origin + location.pathname }
  })
  if (error) throw new Error(humanize(error, '重发确认邮件失败'))
}

/** 邮箱 + 密码登录 */
export async function signInWithPassword(email, password) {
  const sb = await getClient()
  const { error } = await sb.auth.signInWithPassword({
    email: String(email).trim(),
    password: String(password)
  })
  if (error) throw new Error(humanize(error, '登录失败'))
  await refreshSession()
}

/**
 * 邮箱 + 密码注册。
 * 如果项目开了邮箱确认，这里不会立刻有会话 —— 返回 needsConfirm 让界面提示。
 */
export async function signUpWithPassword(email, password, { redirectTo } = {}) {
  const sb = await getClient()
  const { data, error } = await sb.auth.signUp({
    email: String(email).trim(),
    password: String(password),
    options: { emailRedirectTo: redirectTo || location.origin + location.pathname }
  })
  if (error) throw new Error(humanize(error, '注册失败'))
  await refreshSession()
  return { needsConfirm: !data?.session }
}

export async function signOut() {
  const sb = await getClient()
  await sb.auth.signOut()
  setRecoveryMode(false)
  stripAuthParamsFromUrl()
  await refreshSession()
  patchCloudMeta({ userId: '', email: '', initialized: false, lastSyncedAt: '', lastSyncedBy: '' })
}

/* ---------------- 忘记密码 / 重置密码 ---------------- */

/**
 * 回跳地址。
 *
 * 注意**不要带 hash**：本站用 hash 做路由，而地址栏里带上 `#login` 之后再让
 * Supabase 追加 `?code=…` 拼出来的链接是不合法的。这里只回站点根路径，
 * 由应用自己按「有没有会话 + 有没有重置旗标」决定显示哪一屏。
 */
export function authRedirectUrl() {
  return location.origin + location.pathname
}

/**
 * 发「重置密码」邮件。
 * 用户点邮件里的链接回来时，SDK 会建一个**临时会话**并派发 PASSWORD_RECOVERY，
 * 应用据此把界面切到「设置新密码」那一步（见 passwordRecovery()）。
 */
export async function resetPasswordForEmail(email, { redirectTo } = {}) {
  const sb = await getClient()
  const { error } = await sb.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: redirectTo || authRedirectUrl()
  })
  if (error) throw new Error(humanize(error, '发送重置密码邮件失败'))
}

/**
 * 设置新密码。
 * 这里用的是重置链接带回来的那个临时会话；改完由调用方决定是留下还是退出。
 */
export async function updatePassword(newPassword) {
  const sb = await getClient()
  const { error } = await sb.auth.updateUser({ password: String(newPassword) })
  if (error) throw new Error(humanize(error, '设置新密码失败'))
  await refreshSession()
}

/* ---------------- 读写云端 ---------------- */

/** 拉取云端数据；没有行就是 hasRemote: false */
export async function pullCloud() {
  const user = await currentUser()
  if (!user) throw new Error('还没有登录，无法拉取云端数据')
  const sb = await getClient()
  const { data, error } = await sb
    .from(CLOUD_TABLE)
    .select('payload,updated_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw new Error(humanize(error, '读取云端失败'))
  if (!data) return { hasRemote: false, payload: null, updatedAt: '' }
  return { hasRemote: true, payload: data.payload || {}, updatedAt: data.updated_at || '' }
}

/**
 * 写入云端。
 * user_id 由 RLS 兜底校验 —— 就算这里被改成别人的 id，数据库也会拒绝。
 */
export async function pushCloud(payload, { userId } = {}) {
  debug('pushCloud 进入', { bytes: JSON.stringify(payload ?? {}).length, userId })
  const user = userId ? { id: userId } : await currentUser()
  if (!user) throw new Error('还没有登录，无法推送云端数据')
  const body = JSON.stringify(payload ?? {})
  if (body.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`数据太大（${Math.round(body.length / 1024)}KB），云端单次上限约 1MB`)
  }
  const sb = await getClient()
  const { data, error } = await sb
    .from(CLOUD_TABLE)
    .upsert(
      { user_id: user.id, payload: payload ?? {}, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select('updated_at')
    .maybeSingle()
  if (error) throw new Error(humanize(error, '写入云端失败'))
  debug('pushCloud upsert 成功', data)
  const updatedAt = data?.updated_at || new Date().toISOString()
  patchCloudMeta({ userId: user.id, lastSyncedAt: updatedAt, lastSyncedBy: 'push' })
  return { updatedAt }
}

/** 删除云端这份数据（不影响本地） */
export async function deleteCloudData() {
  const user = await currentUser()
  if (!user) throw new Error('还没有登录')
  const sb = await getClient()
  const { error } = await sb.from(CLOUD_TABLE).delete().eq('user_id', user.id)
  if (error) throw new Error(humanize(error, '删除云端数据失败'))
  patchCloudMeta({ lastSyncedAt: '', lastSyncedBy: '', initialized: false })
}

/* ---------------- 现在该往哪边同步 ---------------- */

/**
 * 纯函数：决定同步动作。抽出来是为了能单测（不需要真的连云端）。
 *   localUpdatedAt 本地最后一次改动时间（ISO）
 *   remoteUpdatedAt 云端 updated_at（ISO）
 *   lastSyncedAt 上次同步成功时服务器给的时间戳
 */
export function decideSyncAction({ localUpdatedAt, remoteUpdatedAt, lastSyncedAt }) {
  const t = (v) => (v ? new Date(v).getTime() : 0)
  const local = t(localUpdatedAt)
  const remote = t(remoteUpdatedAt)
  const synced = t(lastSyncedAt)
  const eps = 1000 // 1 秒容差：客户端时钟和服务端不可能完全一致

  if (!remoteUpdatedAt) return { action: 'push', reason: '云端还没有数据' }
  if (!localUpdatedAt) return { action: 'pull', reason: '本地没有改动' }
  if (local > synced + eps && remote > synced + eps) {
    return { action: 'conflict', reason: '两边都有新改动' }
  }
  if (local > synced + eps) return { action: 'push', reason: '本地更新' }
  if (remote > synced + eps) return { action: 'pull', reason: '云端更新' }
  return { action: 'none', reason: '已经是最新' }
}

/** 本地数据是否「基本是空的」—— 用来判断新设备首次登录该不该直接拉云端 */
export function isStateEmpty(state) {
  if (!state) return true
  const arrays = ['quests', 'focus', 'mistakes', 'chapters', 'scores']
  for (const key of arrays) {
    if (Array.isArray(state[key]) && state[key].length > 0) return false
  }
  if (Array.isArray(state.goals) && state.goals.some((g) => Number(g.target) > 0 || Number(g.current) > 0)) {
    return false
  }
  if (Number(state.progress?.exp) > 0) return false
  return true
}

/** 去掉云端不需要的本地开关，避免把设备相关设置在设备之间搬来搬去 */
export function payloadFromState(state) {
  const out = deepCopy(state)
  if (out.settings) {
    delete out.settings.sync
    delete out.settings.supabaseUrl
    delete out.settings.supabaseAnon
  }
  delete out.cloudMeta
  return out
}

/* ---------------- 状态订阅（给界面用） ---------------- */

let status = { state: 'idle', message: '', at: '' }
const statusListeners = new Set()

function setStatus(next, message = '') {
  status = { state: next, message, at: new Date().toISOString() }
  for (const fn of statusListeners) {
    try {
      fn(status)
    } catch (err) {
      console.error('[cloud] 状态订阅回调出错', err)
    }
  }
}

export function cloudStatus() {
  return { ...status }
}

export function onCloudStatus(fn) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/* ---------------- 自动同步 ---------------- */

let hooks = { getPayload: null, applyPayload: null, getLocalUpdatedAt: null }
let pushTimer = null
let inflight = null
/** 同步进行中又产生了新改动：结束后补推一次 */
let dirtyQueued = false

/**
 * 排查同步问题时的日志开关。
 * 在浏览器控制台执行 localStorage.setItem('kivotos-kaoyan-cloud-debug','1') 再刷新，
 * 就会把「同步判定用了哪些时间戳、最后决定推还是拉」打在控制台上。
 */
function debugEnabled() {
  try {
    return localStorage.getItem('kivotos-kaoyan-cloud-debug') === '1'
  } catch {
    return false
  }
}

function debug(...args) {
  if (debugEnabled()) console.warn('[cloud]', ...args)
}

/**
 * 接上应用数据层。
 *   getPayload()        取当前整份数据
 *   applyPayload(payload) 把云端数据写回本地
 *   getLocalUpdatedAt() 本地最后一次改动时间
 *
 * 关于「关页面前补推」：不做了。改动永远先落 localStorage（store 里 120ms 防抖写盘），
 * 推送只是把同一份数据再送一份到云端；没送成的话下次打开会按时间戳补上。
 * 用 fetch(keepalive) 在 beforeunload 里抢发，成功率低、失败还很吵，不划算。
 */
export function initCloudSync(nextHooks) {
  hooks = { ...hooks, ...nextHooks }
}

/** 数据改动后调用：debounce 推送（登录 + 初始化过才有动作） */
export function markLocalDirty() {
  if (!isCloudConfigured()) return
  if (!cloudMeta().initialized) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    if (inflight) {
      // 已经有同步在跑（比如刚登录的首次拉取）：把这次改动排队，等它结束后补推，
      // 不能直接丢掉，否则这一刻勾的那条委托会丢
      dirtyQueued = true
      return
    }
    runSync({ auto: true }).catch((err) => console.warn('[cloud] 自动同步失败', err))
  }, PUSH_DEBOUNCE_MS)
}

/** 立刻推送（不等 debounce），用于「立即同步」按钮 */
export function flushPush() {
  clearTimeout(pushTimer)
  return runSync({ auto: true, force: 'push' })
}

/**
 * 执行一次同步。
 *   auto=true 时遇到冲突不弹窗，只把状态标成 conflict，交给界面提示
 *   direction 传 'push' / 'pull' 可以强制方向
 */
export async function runSync({ auto = false, direction = null, reason = '' } = {}) {
  if (!isCloudConfigured()) return { ok: false, action: 'none', message: '还没配置 Supabase' }
  if (!hooks.getPayload) return { ok: false, action: 'none', message: '同步还没准备好' }
  if (inflight) return inflight

  inflight = (async () => {
    try {
      setStatus('busy', direction === 'pull' ? '正在拉取…' : '正在同步…')
      const user = await currentUser()
      if (!user) {
        setStatus('off', '未登录')
        return { ok: false, action: 'none', message: '未登录' }
      }
      patchCloudMeta({ userId: user.id, email: user.email })

      const remote = await pullCloud()
      const localUpdatedAt = hooks.getLocalUpdatedAt?.() || ''
      const localPayload = hooks.getPayload()
      const localEmpty = isStateEmpty(localPayload)
      if (debugEnabled()) {
        debug('决策输入', {
          localUpdatedAt,
          remoteUpdatedAt: remote.updatedAt,
          hasRemote: remote.hasRemote,
          lastSyncedAt: cloudMeta().lastSyncedAt,
          initialized: cloudMeta().initialized,
          localEmpty
        })
      }

      /**
       * 「本机是空的、云端有东西」→ 直接拉，永远不要问用户。
       *
       * 这条判断必须放在最前面，而且**不要求 initialized**：
       * 全新设备（或刚清过浏览器数据）本来就没有本地同步记录，
       * 如果这时候落进「时间戳谁新」那套判断，就会出现最坏的一种交互 ——
       * 弹窗问「保留哪一边」，而本机其实是空的，用户一旦点错
       * 「保留本机」就等于用一份空白把云端备份覆盖掉。
       * 空 ≠ 用户的最新数据，所以这里不猜、也不问，直接拉。
       */
      if (!direction && localEmpty && remote.hasRemote) {
        hooks.applyPayload(remote.payload)
        patchCloudMeta({
          userId: user.id,
          email: user.email,
          initialized: true,
          lastSyncedAt: remote.updatedAt || new Date().toISOString(),
          lastSyncedBy: 'pull'
        })
        setStatus('synced', '已从云端拉取最新数据')
        return { ok: true, action: 'pull', message: '已拉取云端数据' }
      }

      // 本机空、云端也空：没什么可同步的
      if (!direction && localEmpty && !remote.hasRemote) {
        if (!cloudMeta().initialized) patchCloudMeta({ initialized: true, userId: user.id, email: user.email })
        setStatus('synced', '云端暂无数据')
        return { ok: true, action: 'none', message: '云端暂无数据' }
      }

      let action = direction
      if (!action) {
        if (!cloudMeta().initialized) {
          // 首次：本地是空的就直接拉，本地有数据就推上去
          action = localEmpty ? (remote.hasRemote ? 'pull' : 'none') : 'push'
        } else {
          const decision = decideSyncAction({
            localUpdatedAt,
            remoteUpdatedAt: remote.updatedAt,
            lastSyncedAt: cloudMeta().lastSyncedAt
          })
          action = decision.action
          debug('decideSyncAction 结果', decision)
          if (action === 'conflict') {
            setStatus('conflict', '两边都有新改动，需要你选一边')
            return { ok: false, action: 'conflict', message: '两边都有新改动' }
          }
        }
      }

      if (action === 'pull') {
        if (!remote.hasRemote) {
          setStatus('synced', '云端暂无数据')
          return { ok: true, action: 'none', message: '云端暂无数据' }
        }
        hooks.applyPayload(remote.payload)
        patchCloudMeta({
          initialized: true,
          lastSyncedAt: remote.updatedAt || new Date().toISOString(),
          lastSyncedBy: 'pull',
          userId: user.id,
          email: user.email
        })
        setStatus('synced', '已从云端拉取最新数据')
        return { ok: true, action: 'pull', message: '已拉取云端数据' }
      }

      if (action === 'push') {
        // 本地是空的、云端却有东西时，不许推 —— 那等于用空白覆盖掉备份
        if (localEmpty && remote.hasRemote) {
          setStatus('conflict', '本机没有数据，云端有数据')
          return {
            ok: false,
            action: 'conflict',
            message: '本机没有数据，云端有数据 —— 要用云端覆盖本机吗？'
          }
        }
        if (debugEnabled()) {
          debug('推送', { localUpdatedAt, remoteUpdatedAt: remote.updatedAt, lastSyncedAt: cloudMeta().lastSyncedAt, localEmpty })
        }
        const { updatedAt } = await pushCloud(localPayload, { userId: user.id })
        patchCloudMeta({ initialized: true, lastSyncedAt: updatedAt, lastSyncedBy: 'push' })
        setStatus('synced', '已同步到云端')
        return { ok: true, action: 'push', message: '已同步到云端' }
      }

      // none：没有改动，但确认一下登录状态
      if (!cloudMeta().initialized) patchCloudMeta({ initialized: true, userId: user.id, email: user.email })
      debug('判定为无需同步', { action, localUpdatedAt, remoteUpdatedAt: remote.updatedAt })
      setStatus('synced', '已是最新')
      return { ok: true, action: 'none', message: '已是最新' }
    } catch (err) {
      setStatus('error', err.message)
      return { ok: false, action: 'error', message: err.message }
    } finally {
      inflight = null
      if (dirtyQueued) {
        dirtyQueued = false
        // 等人一个节拍再补推，避免和上面的返回值抢时序
        setTimeout(() => {
          runSync({ auto: true }).catch((err) => console.warn('[cloud] 补推失败', err))
        }, 60)
      }
    }
  })()

  return inflight
}

/** 覆盖：用本地覆盖云端（冲突时用户选「保留本机」） */
export async function forcePush() {
  clearTimeout(pushTimer)
  return runSync({ direction: 'push' })
}

/** 覆盖：用云端覆盖本地（冲突时用户选「保留云端」） */
export async function forcePull() {
  clearTimeout(pushTimer)
  return runSync({ direction: 'pull' })
}
