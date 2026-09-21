/**
 * SQL 语句切分（两个建表脚本共用）。
 *
 * 为什么值得单独抽出来：
 *   天真的「按分号 split」会把 PostgreSQL 的 `$$ ... $$` 函数体切碎 ——
 *   函数体里的分号被当成语句结尾，送出去的是半截 CREATE FUNCTION，
 *   接口回 400/401，看起来像权限问题，其实是切分错了。
 *   这个坑真的踩过（用 Management API 建表时整段报 401），所以只留一份实现，
 *   并且由 test-cloud.mjs 里的断言盯着它。
 */

/**
 * 把一份 SQL 文件切成一条条可单独执行的语句。
 * 认识：美元引用（$$ 与 $tag$）、单引号字符串（含 '' 转义）、
 *      行注释（--）、块注释（/* *​/）。
 */
export function splitStatements(sql) {
  const out = []
  let current = ''
  let i = 0
  let dollarTag = null
  let inSingle = false
  let inLineComment = false
  let inBlockComment = false

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      current += ch
      if (ch === '\n') inLineComment = false
      i++
      continue
    }
    if (inBlockComment) {
      current += ch
      if (ch === '*' && next === '/') {
        current += next
        i += 2
        inBlockComment = false
        continue
      }
      i++
      continue
    }
    if (inSingle) {
      current += ch
      if (ch === "'") {
        if (next === "'") {
          current += next
          i += 2
          continue
        }
        inSingle = false
      }
      i++
      continue
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      current += ch
      i++
      continue
    }

    if (ch === '-' && next === '-') {
      inLineComment = true
      current += ch + next
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      current += ch + next
      i += 2
      continue
    }
    if (ch === "'") {
      inSingle = true
      current += ch
      i++
      continue
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) {
        dollarTag = m[0]
        current += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (ch === ';') {
      out.push(current.trim())
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) out.push(current.trim())

  // 只由注释组成的片段不算语句
  return out.filter((s) => s && !s.split('\n').every((line) => line.trim().startsWith('--')))
}

/** 取一条语句里第一行有意义的文字，用于日志显示 */
export function statementLabel(statement, max = 66) {
  const line = statement.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) || statement
  return line.trim().slice(0, max)
}
