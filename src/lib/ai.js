/**
 * 可选的 AI 接入。
 *
 * 用途：把教材目录 + 剩余天数交给模型，让它排一份更懂"轻重"的阶段计划，
 * 或者估算每个章节大概要几小时。
 *
 * 原则：
 *   - 不配也能用：内置的规则排期（scheduleChapters）已经够日常使用。
 *   - Key 只存在你自己的浏览器里（localStorage），不会发到任何第三方服务器，
 *     请求直接从浏览器发往你自己填的接口。
 *   - 接口必须允许浏览器跨域调用（CORS）。多数 OpenAI 兼容网关都允许。
 */

import { state } from './store.js'
import { SUBJECTS } from './store.js'

export function aiConfig() {
  return state.settings.aiApi || { baseUrl: '', apiKey: '', model: '', enabled: false }
}

export function isAiReady() {
  const cfg = aiConfig()
  return Boolean(cfg.enabled && cfg.baseUrl && cfg.model)
}

function normalizeBase(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  // 允许用户只填到域名，自动补 /v1
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

/** 构造给模型的提示词：把状态摊平成它需要的上下文 */
export function buildPlanPrompt({ subject, book, chapters, startDate, examDate, daysLeft }) {
  const subjectName = SUBJECTS.find((s) => s.id === subject)?.name || subject
  const list = chapters.map((c, i) => `${i + 1}. ${c.title}（估 ${c.hours} 小时）`).join('\n')
  const profile = state.profile
  return [
    `你是一位考研规划老师。请为一位 ${new Date().getFullYear()} 年 12 月参加考研的学生，`,
    `把下面这本教材的目录排进日程。`,
    ``,
    `【学生情况】`,
    `- 科目：${subjectName}`,
    `- 目标院校/专业：${profile.targetSchool || '未填写'} ${profile.targetMajor || ''}`.trim(),
    `- 计划起始日：${startDate}`,
    `- 初试日期：${examDate}（还剩 ${daysLeft} 天）`,
    `- 每天可投入时长：约 ${Math.round((profile.dailyGoalMin || 360) / 60)} 小时（含其他科目）`,
    ``,
    `【教材目录】`,
    list,
    ``,
    `【要求】`,
    `1. 按章节给出建议分配的天数与优先级，难点章节多给时间，简单章节合并。`,
    `2. 指出哪几章是历年高频考点，必须留出二轮复习时间。`,
    `3. 输出严格的 JSON，不要任何解释文字，格式：`,
    `{"chapters":[{"title":"章节名","hours":数字,"priority":"high|mid|low","note":"一句话建议"}],`,
    ` "summary":"三句话以内的整体策略",`,
    ` "milestones":[{"date":"YYYY-MM-DD","what":"里程碑描述"}]}`
  ].join('\n')
}

/** 从模型回复里抠出 JSON（模型经常包一层 ```json 或加前后话） */
export function extractJSON(text) {
  if (!text) throw new Error('模型没有返回内容')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('模型返回的不是 JSON，无法解析')
  return JSON.parse(candidate.slice(start, end + 1))
}

/**
 * 调用接口。返回解析后的对象。
 * 支持 OpenAI 兼容格式（/chat/completions）。
 */
export async function requestPlan({ prompt, signal }) {
  const cfg = aiConfig()
  if (!isAiReady()) throw new Error('还没有配置 AI 接口（在「设置 → AI 接口」里填写）')

  const base = normalizeBase(cfg.baseUrl)
  const endpoint = `${base}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: '你是一位严谨的考研规划老师，只输出 JSON。' },
        { role: 'user', content: prompt }
      ]
    }),
    signal
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`接口返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }

  const data = await response.json()
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.content?.[0]?.text ??
    data?.output_text ??
    ''
  return extractJSON(text)
}

/**
 * 把模型返回的章节安排写回数据层。
 * 容错：字段缺失就用原目录的值兜底。
 */
export function applyAiPlan(plan, { subject, book, chapters, startDate }) {
  const enriched = chapters.map((original, i) => {
    const match = (plan.chapters || []).find((c) => c.title && original.title.includes(c.title.slice(0, 6)))
    const found = match || plan.chapters?.[i]
    return {
      title: original.title,
      hours: Number(found?.hours) > 0 ? Number(found.hours) : original.hours,
      priority: found?.priority || 'mid',
      note: found?.note || ''
    }
  })
  return { subject, book, chapters: enriched, startDate, summary: plan.summary || '', milestones: plan.milestones || [] }
}
