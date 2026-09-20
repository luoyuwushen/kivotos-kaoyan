/**
 * 默认目录模板 + 目录解析 + 目标院校参考分。
 *
 * 数学与专业课的教材目录因学校/版本差异很大，这里给的是**常见版本的结构骨架**，
 * 用户可以直接用，也可以贴自己的目录覆盖掉。这样网站第一次打开就不是空的。
 */

/** 数一/数二/数三的考试范围差异（用于计划时提示） */
export const MATH_SCOPE = {
  math1: {
    name: '数学一',
    note: '高数 + 线代 + 概率论，范围最广，工科学硕常用。',
    units: ['高等数学', '线性代数', '概率论与数理统计'],
    hours: { 高等数学: 220, 线性代数: 70, 概率论与数理统计: 70 }
  },
  math2: {
    name: '数学二',
    note: '高数（不含级数、三重积分等）+ 线代，不考概率论。',
    units: ['高等数学', '线性代数'],
    hours: { 高等数学: 200, 线性代数: 70 }
  },
  math3: {
    name: '数学三',
    note: '高数 + 线代 + 概率论，经济类常用，高数部分要求略低。',
    units: ['高等数学', '线性代数', '概率论与数理统计'],
    hours: { 高等数学: 190, 线性代数: 65, 概率论与数理统计: 75 }
  },
  'no-math': { name: '不考数学', note: '两门专业课组合。', units: [], hours: {} }
}

/** 公共课默认章节骨架（按考试大纲常见划分，可自行替换） */
export const DEFAULT_OUTLINE = {
  math: [
    { book: '高等数学（同济版）上册', chapters: [['函数与极限', 8], ['导数与微分', 6], ['微分中值定理与导数应用', 8], ['不定积分', 8], ['定积分及其应用', 10], ['微分方程', 6]] },
    { book: '高等数学（同济版）下册', chapters: [['向量代数与空间解析几何', 6], ['多元函数微分法', 10], ['重积分', 10], ['曲线积分与曲面积分', 12], ['无穷级数', 10]] },
    { book: '线性代数（同济版）', chapters: [['行列式', 5], ['矩阵及其运算', 6], ['矩阵的初等变换与线性方程组', 6], ['向量组的线性相关性', 7], ['相似矩阵及二次型', 8]] },
    { book: '概率论与数理统计（浙大版）', chapters: [['随机事件与概率', 6], ['随机变量及其分布', 7], ['多维随机变量', 8], ['数字特征', 6], ['大数定律与中心极限定理', 4], ['数理统计的基本概念', 6], ['参数估计与假设检验', 8]] }
  ],
  english: [
    { book: '考研英语 · 词汇', chapters: [['核心词汇 Unit 1-10', 12], ['核心词汇 Unit 11-20', 12], ['核心词汇 Unit 21-30', 12], ['熟词僻义与真题高频词', 8]] },
    { book: '考研英语 · 长难句', chapters: [['句子成分与基本句型', 6], ['三大从句拆解', 8], ['非谓语与特殊结构', 8], ['真题长难句精练', 10]] },
    { book: '考研英语 · 阅读', chapters: [['阅读题型与解题流程', 5], ['细节题与推理题', 8], ['主旨题与态度题', 6], ['真题精读 2015-2018', 12], ['真题精读 2019-2022', 12], ['真题精读 2023-2026', 12]] },
    { book: '考研英语 · 写作与翻译', chapters: [['小作文模板与改写', 6], ['大作文框架与素材', 8], ['翻译技巧与真题', 8]] }
  ],
  politics: [
    { book: '考研政治 · 马原', chapters: [['马克思主义基本原理概论', 12], ['政治经济学', 8], ['科学社会主义', 4]] },
    { book: '考研政治 · 毛中特', chapters: [['毛泽东思想', 8], ['中国特色社会主义理论体系', 12]] },
    { book: '考研政治 · 史纲', chapters: [['近代史纲要', 12]] },
    { book: '考研政治 · 思修法基', chapters: [['思想道德修养与法律基础', 10]] },
    { book: '考研政治 · 时政与冲刺', chapters: [['当年时政专题', 8], ['肖四肖八与冲刺背诵', 20]] }
  ],
  major: [
    { book: '专业课（把我这份换成你的参考书）', chapters: [['参考书一 · 第一章', 8], ['参考书一 · 第二章', 8], ['参考书二 · 第一章', 8], ['真题第一轮', 12], ['真题第二轮', 10], ['专题背诵与模拟', 20]] }
  ]
}

/**
 * 解析用户粘贴的目录文本。
 * 支持的写法（每行一条，尽量宽松）：
 *   第一章 函数与极限
 *   1.2 数列的极限 | 6
 *   第三章 微分方程, 8h
 *   - 行列式（5 小时）
 * 返回 [{ title, hours }]
 */
export function parseOutline(text) {
  if (!text) return []
  const out = []
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (const raw of lines) {
    // 去掉常见的列表符号与 Markdown 标记
    let line = raw.replace(/^[-*•·>#\s]+/, '').replace(/\*\*/g, '').trim()
    if (!line) continue
    // 跳过纯标题行（如「第一章」「目录」「Part 1」）
    if (/^(目\s*录|contents?|part\s*\d+)$/i.test(line)) continue

    let hours = 0
    // 时长：| 6 / , 8h / （5 小时）/ 6小时 / [6]
    const hourPatterns = [
      /[|｜,，\t]\s*(\d+(?:\.\d+)?)\s*(?:h|小时|课时|hrs?)?\s*$/i,
      /[（(【\[]\s*(\d+(?:\.\d+)?)\s*(?:h|小时|课时|hrs?)?\s*[)）】\]]\s*$/i,
      /[-–—]\s*(\d+(?:\.\d+)?)\s*(?:h|小时|课时)\s*$/i
    ]
    for (const re of hourPatterns) {
      const m = re.exec(line)
      if (m) {
        hours = Number(m[1])
        line = line.slice(0, m.index).trim()
        break
      }
    }
    line = line.replace(/[|｜,，\s]+$/, '').trim()
    if (!line) continue
    // 太长的行当作说明文字丢掉
    if (line.length > 80) continue
    out.push({ title: line, hours: hours > 0 ? hours : 2 })
  }
  return out
}

/** 按科目把默认骨架展开成可一键导入的章节列表 */
export function defaultOutlineFor(subject, subjectSet = 'math1') {
  if (subject === 'math') {
    const scope = MATH_SCOPE[subjectSet] || MATH_SCOPE.math1
    const allowed = new Set(scope.units)
    return DEFAULT_OUTLINE.math.filter((group) => {
      if (group.book.includes('概率论')) return allowed.has('概率论与数理统计')
      if (group.book.includes('线性代数')) return allowed.has('线性代数')
      return allowed.has('高等数学')
    })
  }
  return DEFAULT_OUTLINE[subject] || []
}

/** 目标院校分数线参考（示例数据，鼓励用户自己填真实数据） */
export const SCORE_REFERENCES = [
  { label: '国家线（工学 A 区，近年参考）', total: 273, lines: { math: 57, english: 38, politics: 38, major: 57 }, note: '单科线为满分 100 分科目的最低要求，数学/专业课为 150 分制折算。' },
  { label: '国家线（经济学 A 区，近年参考）', total: 346, lines: { math: 72, english: 48, politics: 48, major: 72 }, note: '经济类学硕常见门槛，实际录取通常远高于国家线。' },
  { label: '国家线（文学 A 区，近年参考）', total: 363, lines: { math: 0, english: 52, politics: 52, major: 78 }, note: '文学类不考数学，总分线偏高。' },
  { label: '34 所自划线院校（工科常见区间）', total: 320, lines: { math: 75, english: 50, politics: 50, major: 75 }, note: '自划线院校总分与单科线均高于国家线，热门专业更高。' },
  { label: '985 计算机类热门专业（常见区间）', total: 360, lines: { math: 90, english: 60, politics: 60, major: 90 }, note: '热门专业实际录取分常在 370+，务必查目标院校近三年拟录取名单。' }
]

/** 计算各科目标分建议：按总分与科目权重拆解 */
export function suggestTargets(totalTarget, subjectSet = 'math1') {
  const hasMath = subjectSet !== 'no-math'
  if (hasMath) {
    return [
      { subject: 'math', target: Math.round(totalTarget * 0.27), full: 150 },
      { subject: 'english', target: Math.round(totalTarget * 0.18), full: 100 },
      { subject: 'politics', target: Math.round(totalTarget * 0.17), full: 100 },
      { subject: 'major', target: Math.round(totalTarget * 0.38), full: 150 }
    ]
  }
  return [
    { subject: 'math', target: 0, full: 150 },
    { subject: 'english', target: Math.round(totalTarget * 0.24), full: 100 },
    { subject: 'politics', target: Math.round(totalTarget * 0.22), full: 100 },
    { subject: 'major', target: Math.round(totalTarget * 0.54), full: 150 }
  ]
}
