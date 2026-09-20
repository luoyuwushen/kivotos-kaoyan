/**
 * 勋章定义。
 * 每枚勋章有一个 id、归属角色、稀有度、以及一个判定函数。
 * 判定函数的入参是一个扁平化的 stats 快照（见 `buildSnapshot`）。
 *
 * 判定原则：只认「真的做过的事」，不认注册天数。
 */

export const RARITY = {
  bronze: { label: '一线', color: 'var(--accent)', ring: 'var(--accent-soft)' },
  silver: { label: '二线', color: 'var(--arona)', ring: 'rgba(91, 200, 245, 0.2)' },
  gold: { label: '三线', color: 'var(--star)', ring: 'rgba(255, 201, 60, 0.22)' },
  pink: { label: '特别', color: 'var(--hoshino)', ring: 'rgba(242, 160, 191, 0.22)' }
}

export const MEDALS = [
  {
    id: 'first_quest',
    name: '第一份委托',
    owner: 'arona',
    rarity: 'bronze',
    desc: '完成第一件每日委托。万事开头难，你已经过了这一关。',
    check: (s) => s.doneQuests >= 1
  },
  {
    id: 'quest_50',
    name: '事务局熟客',
    owner: 'arona',
    rarity: 'bronze',
    desc: '累计完成 50 件委托。',
    check: (s) => s.doneQuests >= 50
  },
  {
    id: 'quest_300',
    name: '委托收割者',
    owner: 'hoshino',
    rarity: 'silver',
    desc: '累计完成 300 件委托。',
    check: (s) => s.doneQuests >= 300
  },
  {
    id: 'quest_1000',
    name: '基沃托斯劳动模范',
    owner: 'hoshino',
    rarity: 'gold',
    desc: '累计完成 1000 件委托。到这一步，习惯已经长在你身上了。',
    check: (s) => s.doneQuests >= 1000
  },
  {
    id: 'focus_first',
    name: '第一个番茄',
    owner: 'arona',
    rarity: 'bronze',
    desc: '完成第一段专注计时。',
    check: (s) => s.totalFocusMin >= 25
  },
  {
    id: 'focus_10h',
    name: '十小时',
    owner: 'arona',
    rarity: 'bronze',
    desc: '累计专注 10 小时。',
    check: (s) => s.totalFocusMin >= 600
  },
  {
    id: 'focus_100h',
    name: '百小时',
    owner: 'hoshino',
    rarity: 'silver',
    desc: '累计专注 100 小时。',
    check: (s) => s.totalFocusMin >= 6000
  },
  {
    id: 'focus_500h',
    name: '五百小时',
    owner: 'hoshino',
    rarity: 'gold',
    desc: '累计专注 500 小时。这个数字里没有运气。',
    check: (s) => s.totalFocusMin >= 30000
  },
  {
    id: 'streak_3',
    name: '三日不断',
    owner: 'arona',
    rarity: 'bronze',
    desc: '连续打卡 3 天。',
    check: (s) => s.bestStreak >= 3
  },
  {
    id: 'streak_7',
    name: '一周坚持',
    owner: 'plana',
    rarity: 'bronze',
    desc: '连续打卡 7 天。',
    check: (s) => s.bestStreak >= 7
  },
  {
    id: 'streak_30',
    name: '三十日作战',
    owner: 'hoshino',
    rarity: 'silver',
    desc: '连续打卡 30 天。撑过一个月，就很难停下来了。',
    check: (s) => s.bestStreak >= 30
  },
  {
    id: 'streak_100',
    name: '百日不辍',
    owner: 'hoshino',
    rarity: 'gold',
    desc: '连续打卡 100 天。',
    check: (s) => s.bestStreak >= 100
  },
  {
    id: 'chapter_10',
    name: '过完十章',
    owner: 'arona',
    rarity: 'bronze',
    desc: '完成 10 个教材章节。',
    check: (s) => s.chaptersDone >= 10
  },
  {
    id: 'chapter_50',
    name: '目录清道夫',
    owner: 'hoshino',
    rarity: 'silver',
    desc: '完成 50 个教材章节。',
    check: (s) => s.chaptersDone >= 50
  },
  {
    id: 'mistake_10',
    name: '错题猎人',
    owner: 'plana',
    rarity: 'bronze',
    desc: '记录 10 条错题或薄弱知识点。',
    check: (s) => s.mistakes >= 10
  },
  {
    id: 'mistake_solid_20',
    name: '薄弱点清剿',
    owner: 'plana',
    rarity: 'silver',
    desc: '把 20 条错题复习到「熟练」。',
    check: (s) => s.mistakesSolid >= 20
  },
  {
    id: 'days_300',
    name: '三百日战线',
    owner: 'hoshino',
    rarity: 'bronze',
    desc: '距初试还剩 300 天以内，你已经在路上了。',
    check: (s) => s.daysLeft <= 300
  },
  {
    id: 'days_100',
    name: '最后一百天',
    owner: 'hoshino',
    rarity: 'silver',
    desc: '进入初试前 100 天。接下来拼的是稳定。',
    check: (s) => s.daysLeft <= 100
  },
  {
    id: 'days_30',
    name: '最后三十天',
    owner: 'hoshino',
    rarity: 'gold',
    desc: '进入初试前 30 天。把会的拿稳，就是胜利。',
    check: (s) => s.daysLeft <= 30
  },
  {
    id: 'night_owl',
    name: '深夜的值班',
    owner: 'plana',
    rarity: 'pink',
    desc: '在 23:00 之后完成一次专注。……记得早点睡。',
    check: (s) => s.hasLateNight
  },
  {
    id: 'early_bird',
    name: '清晨的第一盏灯',
    owner: 'arona',
    rarity: 'pink',
    desc: '在 7:00 之前完成一次专注。',
    check: (s) => s.hasEarlyMorning
  },
  {
    id: 'plan_made',
    name: '作战计划',
    owner: 'arona',
    rarity: 'bronze',
    desc: '生成过一次阶段计划。有计划的人和没计划的人，进度会差很远。',
    check: (s) => s.hasPhases
  },
  {
    id: 'goal_set',
    name: '立下目标',
    owner: 'hoshino',
    rarity: 'bronze',
    desc: '设定了至少一科的目标分。',
    check: (s) => s.hasGoals
  },
  {
    id: 'all_subjects',
    name: '四科齐全',
    owner: 'arona',
    rarity: 'silver',
    desc: '四大科目都建了教材章节或委托。短板决定总分。',
    check: (s) => s.subjectsCovered >= 4
  }
]

/**
 * 从当前 state 生成扁平快照，供所有 check 使用。
 * stats 由 store.stats() 提供，这里只做补充计算。
 */
export function buildSnapshot({ stats, state, daysLeft }) {
  const subjectsWithWork = new Set([
    ...state.chapters.map((c) => c.subject),
    ...state.quests.map((q) => q.subject)
  ])
  const hours = state.focus.map((f) => new Date(f.start).getHours())
  return {
    ...stats,
    bestStreak: Math.max(state.progress.bestStreak, stats.streak),
    daysLeft,
    hasPhases: state.phases.length > 0,
    hasGoals: state.goals.some((g) => g.target > 0),
    subjectsCovered: subjectsWithWork.size,
    hasLateNight: hours.some((h) => h >= 23 || h < 2),
    hasEarlyMorning: hours.some((h) => h >= 5 && h < 7)
  }
}

/** 返回所有已解锁勋章 id 列表（不写库，纯计算） */
export function evaluate(snapshot, unlocked = {}) {
  return MEDALS.filter((m) => {
    try {
      return m.check(snapshot)
    } catch {
      return false
    }
  }).map((m) => m.id)
}

/** 计算新解锁的勋章（用于弹提示） */
export function findNewlyUnlocked(snapshot, unlockedMap = {}) {
  const hit = evaluate(snapshot, unlockedMap)
  return hit.filter((id) => !unlockedMap[id]).map((id) => MEDALS.find((m) => m.id === id))
}
