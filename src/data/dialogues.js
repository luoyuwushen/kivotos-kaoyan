/**
 * 台词库。
 *
 * 星野（小鸟游星野）是本站的"主讲述人"：她是前辈、爱睡觉、嘴硬心软，
 * 所以台词写的是"陪着你熬"的语气，不是励志海报腔，也不是客服口吻。
 * 阿洛娜是系统助手（负责提醒、报数），普拉娜负责在低谷时说话。
 */

import { seededIndex } from '../lib/utils.js'

/** 星野的台词：按场景分组 */
export const HOSHINO_LINES = {
  // 首页常驻问候，按剩余天数区间挑
  greeting: [
    '唔……早啊。今天的委托单我已经帮你看过了，先从最不想做的那一科开始吧，做完就轻松了。',
    '前辈我当年也是这么过来的。别急着看还有多少天，先看今天要做什么。',
    '……又熬夜了？我可没说你可以拿身体换进度哦。',
    '把今天该做的做完，剩下的时间去睡一觉。这才是能撑到最后的方法。',
    '嗯，状态看起来还行。那就开始吧，我在这儿陪着。',
    '别一个人硬扛。卡住了就先跳过，标记一下，晚上我们一起收拾它。',
    '今天是那种"不想学"的日子吧？那就只做最小的一份，做完了算你赢。',
    '我记得你说过想去那所学校的。现在这一页书，就是往那边走的一步。'
  ],
  // 全部委托完成
  allDone: [
    '全部做完了？……不错嘛。今天可以理直气壮地去休息了。',
    '委托单清空了。前辈我说到做到——该奖励你一下，去吃点好的。',
    '嗯，今天这份成绩我记下了。明天也这样，就没人拦得住你。'
  ],
  // 一条都没做
  idle: [
    '委托单还空着哦。要不……先挑一件最最小的做掉？开了头就不难了。',
    '在发呆？我也很喜欢发呆。不过发完呆，咱们就动一下，好吗。',
    '没关系，现在开始也不算晚。先做 25 分钟，剩下的交给惯性。'
  ],
  // 落后阶段进度
  behind: [
    '进度有点落后了……不过别慌，我们把落后的部分拆小一点，一天补一点。',
    '计划赶不上变化很正常。改计划，不要改目标。',
    '唔……这个进度我得说一句：要不这周少安排一点新内容，先把旧的消化掉？'
  ],
  // 专注计时中
  focusing: [
    '在学呢，那我不打扰你了。……我就坐这儿，不说话。',
    '专注中。加油，我一直看着表呢。',
    '这一段结束就起来走两步，别坐着不动。'
  ],
  // 考完 / 临近
  finalStretch: [
    '就剩最后这点时间了。别再学新东西了，把会的都拿稳。',
    '这个阶段拼的是作息和心态。你比你以为的要准备得更多。',
    '深呼吸。你已经走了这么远了，剩下的路，走稳就行。'
  ]
}

/** 阿洛娜：系统助手口吻，负责报数字、给提醒 */
export const ARONA_LINES = [
  'Sensei，今天的委托单已经准备好了！',
  '累计学习时间更新啦，要继续保持哦！',
  '检测到有逾期委托，需要我帮你顺延到今天吗？',
  '专注计时器已就绪，随时可以开始！',
  '今天的进度已记录，数据保存在你自己的设备上。'
]

/** 普拉娜：安静、在低谷时出现 */
export const PLANA_LINES = [
  '……不用着急。数字只是数字，你还在走，这就够了。',
  '状态不好的日子，也是备考的一部分。',
  '如果今天只能做一件事，就做那件最让你安心的。',
  '慢慢来。我在。'
]

/**
 * 按天取一句星野台词：同一天刷新页面也是同一句，
 * 点了「再听一句」才会换（用 turn 打散种子）。
 */
export function hoshinoLine(scene = 'greeting', turn = 0, dateKey = '') {
  const lines = HOSHINO_LINES[scene] || HOSHINO_LINES.greeting
  return lines[seededIndex(`${dateKey}|${scene}|${turn}`, lines.length)]
}

export function aronaLine(turn = 0, dateKey = '') {
  return ARONA_LINES[seededIndex(`${dateKey}|arona|${turn}`, ARONA_LINES.length)]
}

export function planaLine(turn = 0, dateKey = '') {
  return PLANA_LINES[seededIndex(`${dateKey}|plana|${turn}`, PLANA_LINES.length)]
}

/** 根据今日状态自动挑场景 */
export function pickScene({ days, phaseBehind, todayTotal, todayDone, dueMistakes }) {
  if (days <= 30) return 'finalStretch'
  if (todayTotal === 0 && todayDone === 0 && !dueMistakes) return 'idle'
  if (todayTotal > 0 && todayDone >= todayTotal) return 'allDone'
  if (phaseBehind) return 'behind'
  return 'greeting'
}

/** 空状态的引导语：永远给一个「下一步」，不写"暂无数据" */
export const EMPTY_HINTS = {
  quests: '今天还没有委托。点右上角「＋ 添加委托」，或者去「阶段计划」让它自动排。',
  chapters: '还没有教材目录。把目录按「一行一章」贴进来，我帮你排进日程。',
  mistakes: '错题本还是空的。做错的题记一条，标上科目，之后按遗忘曲线提醒你复习。',
  focus: '还没有专注记录。去「专注计时」跑第一个番茄吧，25 分钟就算一份。',
  scores: '还没有分数线数据。填一条目标院校的历年分数，差距就看得见了。',
  goals: '还没设各科目标分。先把总分目标拆到四科，进度条才有意义。'
}
