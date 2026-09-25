/**
 * 给本地测试用的「已登录」环境。
 *
 * 为什么需要它：站点配了 Supabase 之后，**没登录就进不去应用**（登录屏接管首屏）。
 * 那些只关心站内功能的测试（交互冒烟、分数规则…）本来只管点页面，
 * 现在必须先有一份有效的本地会话，否则会被登录屏挡住 —— 报出来的错是
 * 「找不到 XXX 按钮」，看着像功能坏了，其实是没登录。
 *
 * 做法：
 *   1. 造一个格式正确的 JWT 会话，写进 supabase-js 用的那个 storageKey；
 *   2. 把产物指向的 Supabase 域名整个拦下来，用最简单的响应顶回去
 *      （这类测试不验同步协议，只要应用不报错就行；同步协议由 test-cloud.mjs 专门验）。
 *
 * 域名是从构建产物里读的，不是从 .env 读的 —— 构建时如果进程环境变量给过
 * VITE_SUPABASE_URL，产物里的地址会和 .env 不一致，按 .env 拦就一条也拦不住，
 * 测试会真的打到线上项目上。
 */

import { createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

/** 会话在 localStorage 里的键名，必须和 src/lib/cloud.js 的 AUTH_STORAGE_KEY 一致 */
export const AUTH_KEY = 'kivotos-kaoyan-auth'
/** 本地数据 / 同步元信息的键名 */
export const STORAGE_KEY = 'kivotos-kaoyan-v1'
export const META_KEY = 'kivotos-kaoyan-cloud-meta-v1'

const TEST_USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'local-test@example.com' }

/** 产物里烘焙的 Supabase 地址（扫所有 chunk） */
export function bakedSupabaseUrl() {
  try {
    const dir = new URL('../../dist/assets/', import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const code = readFileSync(new URL(file, dir), 'utf8')
      const m = /https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)/.exec(code)
      if (m) return m[0]
    }
    return ''
  } catch {
    return ''
  }
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/**
 * 造一份 supabase-js 认得的会话。
 *
 * expires_at 给足 1 小时 —— 给短了 SDK 会自己拿 refresh_token 去换新 token，
 * 而这里根本没有真服务端，换来一个失败之后它会把会话清掉，测试又掉回登录屏。
 */
export function fakeSession(user = TEST_USER) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600
  })
  // 前端不会验签（真正的门锁是数据库 RLS），签名随便给一个形状正确的即可
  const sig = createHmac('sha256', 'local-test-only').update(`${header}.${payload}`).digest('base64url')
  return {
    access_token: `${header}.${payload}.${sig}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `local-test-refresh-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  }
}

/**
 * 让这个页面「已经登录」，并把后端请求全部拦掉。
 * 必须在第一次 goto 之前调用（用的是 addInitScript）。
 *
 * 关于同步元信息：**默认不写**。
 * 写了 `initialized: true` 就等于告诉应用"这台设备已经同步过了"，
 * 会连带压掉「首次进入的对账」和「首次使用引导」—— 而恰恰有测试要验首次流程。
 * 需要跳过首次同步的人显式传 seedMeta。
 *
 * @param {import('playwright').Page} page
 * @param {{ seedState?: object, seedMeta?: object }} [opts]
 */
export async function installFakeBackend(page, { seedState, seedMeta } = {}) {
  const url = bakedSupabaseUrl()
  const respond = (route) => {
      const method = route.request().method()
      // PostgREST 读取用 null 表示"没有行"，写入回 201 空体；auth 端点回空对象就够
      const body = method === 'GET' ? 'null' : '{}'
      return route.fulfill({
        status: method === 'GET' ? 200 : 201,
        contentType: 'application/json',
        body
      })
  }
  // dev server 没有构建产物；仍须拦住所有 Supabase 请求，绝不能悄悄外发。
  await page.route(/^https?:\/\/[^/]+\.supabase\.(?:co|in)\//, respond)
  if (url) await page.route(`${url}/**`, respond)

  await page.addInitScript(({ authKey, session, storageKey, metaKey, seedState, seedMeta }) => {
    localStorage.setItem(authKey, JSON.stringify(session))
    if (seedState) localStorage.setItem(storageKey, JSON.stringify(seedState))
    if (seedMeta) localStorage.setItem(metaKey, JSON.stringify(seedMeta))
  }, {
    authKey: AUTH_KEY,
    session: fakeSession(),
    storageKey: STORAGE_KEY,
    metaKey: META_KEY,
    seedState,
    seedMeta
  })
}
