/** 登录教室按访客本地时间选幕；静态预览与 Spine 场景共用此规则。 */
export const DAY_SCENES = ['day_1', 'day_2', 'day_3', 'day_4']
export const NIGHT_SCENES = ['night_1', 'night_2', 'night_3', 'night_4', 'night_5']

export function sceneForHour(hour = new Date().getHours()) {
  const h = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : 12
  const list = h >= 6 && h < 18 ? DAY_SCENES : NIGHT_SCENES
  return list[h % list.length]
}
