/**
 * SQLite 事实存储层。
 * 移植自 Hermes holographic/store.py，使用 bun:sqlite 同步 API。
 *
 * 职责：
 * - CRUD 操作（facts + entities + fact_entities）
 * - 实体自动提取（正则模式）
 * - 信任评分反馈（非对称调整）
 * - 去重（content UNIQUE 约束）
 */

import { Database, type Statement } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA } from './schema'
import type { Fact, FactCategory } from '../types'

// 信任评分常量
const HELPFUL_DELTA = 0.05
const UNHELPFUL_DELTA = -0.10
const TRUST_MIN = 0.0
const TRUST_MAX = 1.0

// 实体提取正则
const RE_CAPITALIZED = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
const RE_DOUBLE_QUOTE = /"([^"]+)"/g
const RE_SINGLE_QUOTE = /'([^']+)'/g
const RE_AKA = /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi
// 中文实体提取正则
const RE_CN_QUOTED = /[「」""'']([^「」""'']{2,20})[「」""'']?/g
const RE_CN_BOOK = /《([^》]+)》/g
// 中文停用词
const CN_STOP_WORDS = new Set([
  '这个', '那个', '什么', '怎么', '为什么', '可以', '应该', '需要',
  '使用', '进行', '通过', '关于', '对于', '根据', '以及', '或者',
  '但是', '因为', '所以', '如果', '虽然', '已经', '正在', '没有',
  '不是', '一个', '一种', '一些', '我们', '他们', '自己', '这些',
  '那些', '可能', '能够', '就是', '还是', '只要', '只有', '然后',
  '所以', '因为', '但是', '而且', '或者', '以及', '如果', '虽然',
])

function clampTrust(value: number): number {
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, value))
}

/** facts 表行类型 */
interface FactRow {
  fact_id: number
  content: string
  category: string
  tags: string
  trust_score: number
  retrieval_count: number
  helpful_count: number
  created_at: string
  updated_at: string
}

/** entities 表行类型 */
interface EntityRow {
  entity_id: number
  name: string
  entity_type: string
  aliases: string
  created_at: string
}

export class MemoryStore {
  private db: Database

  // 预编译语句
  private stmtInsertFact!: Statement
  private stmtFindFactByContent!: Statement
  private stmtFindEntityByName!: Statement
  private stmtFindEntityByAlias!: Statement
  private stmtInsertEntity!: Statement
  private stmtInsertFactEntity!: Statement
  private stmtDeleteFactEntities!: Statement
  private stmtGetEntitiesForFact!: Statement

  constructor(dbPath: string, private defaultTrust = 0.5) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath, { create: true })
    this.db.run('PRAGMA journal_mode=WAL')
    this.db.run('PRAGMA foreign_keys=ON')
    this.initSchema()
    this.prepareStatements()
  }

  private initSchema(): void {
    this.db.exec(SCHEMA)
  }

  private prepareStatements(): void {
    this.stmtInsertFact = this.db.prepare(
      'INSERT INTO facts (content, category, tags, trust_score) VALUES (?, ?, ?, ?)'
    )
    this.stmtFindFactByContent = this.db.prepare(
      'SELECT fact_id FROM facts WHERE content = ?'
    )
    this.stmtFindEntityByName = this.db.prepare(
      'SELECT entity_id FROM entities WHERE name = ?'
    )
    this.stmtFindEntityByAlias = this.db.prepare(
      "SELECT entity_id FROM entities WHERE ',' || aliases || ',' LIKE '%,' || ? || ',%'"
    )
    this.stmtInsertEntity = this.db.prepare(
      'INSERT INTO entities (name) VALUES (?)'
    )
    this.stmtInsertFactEntity = this.db.prepare(
      'INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)'
    )
    this.stmtDeleteFactEntities = this.db.prepare(
      'DELETE FROM fact_entities WHERE fact_id = ?'
    )
    this.stmtGetEntitiesForFact = this.db.prepare(
      `SELECT e.name FROM entities e
       JOIN fact_entities fe ON fe.entity_id = e.entity_id
       WHERE fe.fact_id = ?`
    )
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** 添加事实，返回 fact_id。精确重复返回已有 ID。 */
  addFact(content: string, category: FactCategory = 'general', tags = ''): number {
    const trimmed = content.trim()
    if (!trimmed) throw new Error('content must not be empty')

    // 将中文 bigram 追加到 tags，让 FTS5 能索引中文词组
    const enhancedTags = this.enhanceTagsForChinese(trimmed, tags)

    const insertFacts = this.db.transaction(() => {
      try {
        const info = this.stmtInsertFact.run(trimmed, category, enhancedTags, this.defaultTrust)
        const factId = Number(info.lastInsertRowid)

        // 实体提取和关联（只从内容中提取，不从 tags 提取）
        const entities = this.extractEntities(trimmed)
        for (const name of entities) {
          const entityId = this.resolveEntity(name)
          this.stmtInsertFactEntity.run(factId, entityId)
        }

        return factId
      } catch (err: unknown) {
        // UNIQUE 冲突 — 返回已有 ID
        if (err instanceof Error && err.message?.includes('UNIQUE')) {
          const row = this.stmtFindFactByContent.get(trimmed) as { fact_id: number } | null
          return row ? row.fact_id : -1
        }
        throw err
      }
    })

    return insertFacts()
  }

  /** 查找语义相似的事实（Jaccard >= threshold），用于调用方决定 update vs add */
  findSimilarFact(content: string, category: FactCategory, threshold = 0.6): Fact | null {
    const tokens = this.tokenizeForDedup(content)
    if (tokens.size < 3) return null
    const existing = this.listFacts(category, 0.0, 50)
    for (const fact of existing) {
      const factTokens = this.tokenizeForDedup(fact.content)
      const sim = this.jaccardSimilarity(tokens, factTokens)
      if (sim >= threshold) return fact
    }
    return null
  }

  /** FTS5 全文搜索 */
  searchFacts(
    query: string,
    category?: FactCategory,
    minTrust = 0.3,
    limit = 10,
  ): Fact[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    const params: unknown[] = [trimmed, minTrust]
    let categoryClause = ''
    if (category) {
      categoryClause = 'AND f.category = ?'
      params.push(category)
    }
    params.push(limit)

    const sql = `
      SELECT f.fact_id, f.content, f.category, f.tags,
             f.trust_score, f.retrieval_count, f.helpful_count,
             f.created_at, f.updated_at
      FROM facts f
      JOIN facts_fts fts ON fts.rowid = f.fact_id
      WHERE facts_fts MATCH ?
        AND f.trust_score >= ?
        ${categoryClause}
      ORDER BY fts.rank, f.trust_score DESC
      LIMIT ?
    `

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as FactRow[]
    const results = rows.map(r => this.rowToFact(r))

    // 递增检索计数
    if (results.length > 0) {
      const ids = results.map(r => r.factId)
      const placeholders = ids.map(() => '?').join(',')
      this.db.prepare(
        `UPDATE facts SET retrieval_count = retrieval_count + 1 WHERE fact_id IN (${placeholders})`
      ).run(...ids)
    }

    return results
  }

  /** 部分更新事实 */
  updateFact(
    factId: number,
    updates: {
      content?: string
      tags?: string
      category?: FactCategory
      trustDelta?: number
    },
  ): boolean {
    const row = this.db.prepare('SELECT fact_id, trust_score FROM facts WHERE fact_id = ?')
      .get(factId) as (Pick<FactRow, 'fact_id' | 'trust_score'>) | null
    if (!row) return false

    const assignments: string[] = ["updated_at = datetime('now')"]
    const params: unknown[] = []

    if (updates.content !== undefined) {
      assignments.push('content = ?')
      params.push(updates.content.trim())
    }
    if (updates.tags !== undefined) {
      assignments.push('tags = ?')
      params.push(updates.tags)
    }
    if (updates.category !== undefined) {
      assignments.push('category = ?')
      params.push(updates.category)
    }
    if (updates.trustDelta !== undefined) {
      const newTrust = clampTrust(row.trust_score + updates.trustDelta)
      assignments.push('trust_score = ?')
      params.push(newTrust)
    }

    params.push(factId)
    this.db.prepare(`UPDATE facts SET ${assignments.join(', ')} WHERE fact_id = ?`).run(...params)

    // 内容变更时重新提取实体
    if (updates.content !== undefined) {
      this.stmtDeleteFactEntities.run(factId)
      const entities = this.extractEntities(updates.content)
      for (const name of entities) {
        const entityId = this.resolveEntity(name)
        this.stmtInsertFactEntity.run(factId, entityId)
      }
    }

    return true
  }

  /** 删除事实 */
  removeFact(factId: number): boolean {
    const row = this.db.prepare('SELECT fact_id FROM facts WHERE fact_id = ?').get(factId)
    if (!row) return false
    this.stmtDeleteFactEntities.run(factId)
    this.db.prepare('DELETE FROM facts WHERE fact_id = ?').run(factId)
    return true
  }

  /** 浏览事实（按信任评分排序） */
  listFacts(category?: FactCategory, minTrust = 0.0, limit = 50): Fact[] {
    const params: unknown[] = [minTrust]
    let categoryClause = ''
    if (category) {
      categoryClause = 'AND category = ?'
      params.push(category)
    }
    params.push(limit)

    const sql = `
      SELECT fact_id, content, category, tags, trust_score,
             retrieval_count, helpful_count, created_at, updated_at
      FROM facts
      WHERE trust_score >= ?
        ${categoryClause}
      ORDER BY trust_score DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params) as FactRow[]
    return rows.map(r => this.rowToFact(r))
  }

  /** 记录反馈，调整信任评分 */
  recordFeedback(factId: number, helpful: boolean): { oldTrust: number; newTrust: number; helpfulCount: number } {
    const row = this.db.prepare(
      'SELECT fact_id, trust_score, helpful_count FROM facts WHERE fact_id = ?'
    ).get(factId) as (Pick<FactRow, 'fact_id' | 'trust_score' | 'helpful_count'>) | null
    if (!row) throw new Error(`fact_id ${factId} not found`)

    const oldTrust = row.trust_score
    const delta = helpful ? HELPFUL_DELTA : UNHELPFUL_DELTA
    const newTrust = clampTrust(oldTrust + delta)
    const helpfulIncrement = helpful ? 1 : 0

    this.db.prepare(`
      UPDATE facts
      SET trust_score = ?, helpful_count = helpful_count + ?, updated_at = datetime('now')
      WHERE fact_id = ?
    `).run(newTrust, helpfulIncrement, factId)

    return {
      oldTrust,
      newTrust,
      helpfulCount: row.helpful_count + helpfulIncrement,
    }
  }

  /** 按实体名查询关联事实 */
  getFactsByEntity(entityName: string, category?: FactCategory, limit = 10): Fact[] {
    const params: unknown[] = [entityName]
    let categoryClause = ''
    if (category) {
      categoryClause = 'AND f.category = ?'
      params.push(category)
    }
    params.push(limit)

    const sql = `
      SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score,
             f.retrieval_count, f.helpful_count, f.created_at, f.updated_at
      FROM facts f
      JOIN fact_entities fe ON f.fact_id = fe.fact_id
      JOIN entities e ON fe.entity_id = e.entity_id
      WHERE e.name LIKE ?
        ${categoryClause}
      ORDER BY f.trust_score DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params) as FactRow[]
    return rows.map(r => this.rowToFact(r))
  }

  /** 按多实体 AND 查询（同时关联多个实体的事实） */
  getFactsByEntities(entities: string[], category?: FactCategory, limit = 10): Fact[] {
    if (entities.length === 0) return []

    // 构建 INTERSECT 查询
    const intersects = entities.map(() =>
      `SELECT fe.fact_id FROM fact_entities fe
       JOIN entities e ON fe.entity_id = e.entity_id
       WHERE e.name LIKE ?`
    ).join(' INTERSECT ')

    const params: unknown[] = [...entities]
    let categoryClause = ''
    if (category) {
      categoryClause = 'AND f.category = ?'
      params.push(category)
    }
    params.push(limit)

    const sql = `
      SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score,
             f.retrieval_count, f.helpful_count, f.created_at, f.updated_at
      FROM facts f
      WHERE f.fact_id IN (${intersects})
        ${categoryClause}
      ORDER BY f.trust_score DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params) as FactRow[]
    return rows.map(r => this.rowToFact(r))
  }

  /** 获取事实关联的实体名列表 */
  getEntitiesForFact(factId: number): string[] {
    const rows = this.stmtGetEntitiesForFact.all(factId) as Pick<EntityRow, 'name'>[]
    return rows.map(r => r.name)
  }

  /** 获取事实总数 */
  getTotalCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM facts').get() as { count: number }
    return row.count
  }

  /** 获取数据库连接（供 FactRetriever 直接使用） */
  get connection(): Database {
    return this.db
  }

  /** 语义去重：查找 Jaccard >= 0.7 的相似事实 */
  private findSimilar(content: string, category: FactCategory): Fact | null {
    const tokens = this.tokenizeForDedup(content)
    if (tokens.size < 3) return null // 太短不检查

    const existing = this.listFacts(category, 0.0, 50)
    for (const fact of existing) {
      const factTokens = this.tokenizeForDedup(fact.content)
      const sim = this.jaccardSimilarity(tokens, factTokens)
      if (sim >= 0.7) return fact
    }
    return null
  }

  /** 去重用分词：英文空格分词 + 中文 bigram */
  private tokenizeForDedup(text: string): Set<string> {
    const tokens = new Set<string>()
    // 英文 token
    for (const word of text.toLowerCase().split(/\s+/)) {
      const cleaned = word.replace(/[.,;:!?"'(){}[\]#@<>]/g, '')
      if (cleaned && cleaned.length > 1) tokens.add(cleaned)
    }
    // 中文 bigram
    const cnChars = text.match(/[\u4e00-\u9fff]+/g) ?? []
    for (const segment of cnChars) {
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.add(segment.slice(i, i + 2))
      }
    }
    return tokens
  }

  /** Jaccard 相似度 */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    let intersection = 0
    for (const item of a) {
      if (b.has(item)) intersection++
    }
    const unionSize = a.size + b.size - intersection
    return unionSize > 0 ? intersection / unionSize : 0
  }

  /** 将中文 bigram 追加到 tags，让 FTS5 能检索中文词组 */
  private enhanceTagsForChinese(content: string, tags: string): string {
    const bigrams: string[] = []
    const cnChars = content.match(/[\u4e00-\u9fff]+/g) ?? []
    for (const segment of cnChars) {
      for (let i = 0; i < segment.length - 1; i++) {
        const bg = segment.slice(i, i + 2)
        if (!CN_STOP_WORDS.has(bg)) {
          bigrams.push(bg)
        }
      }
    }
    if (bigrams.length === 0) return tags
    const existingTags = tags ? tags + ',' : ''
    return existingTags + bigrams.join(',')
  }

  /** 实体类型分类 */
  private classifyEntity(name: string): string {
    // 纯中文 2-4 字 → person（可能是人名）
    if (/^[\u4e00-\u9fff]{2,4}$/.test(name)) return 'person'
    // 含英文 → technology
    if (/[A-Za-z]/.test(name)) return 'technology'
    // 中文 5+ 字 → topic
    if (/^[\u4e00-\u9fff·]{5,}$/.test(name)) return 'topic'
    return 'unknown'
  }

  close(): void {
    this.db.close()
  }

  // ------------------------------------------------------------------
  // 内部方法
  // ------------------------------------------------------------------

  private resolveEntity(name: string): number {
    // 精确名称匹配
    const byName = this.stmtFindEntityByName.get(name) as Pick<EntityRow, 'entity_id'> | null
    if (byName) return byName.entity_id

    // 别名匹配
    const byAlias = this.stmtFindEntityByAlias.get(name) as Pick<EntityRow, 'entity_id'> | null
    if (byAlias) return byAlias.entity_id

    // 创建新实体，自动填充 entity_type
    const entityType = this.classifyEntity(name)
    const info = this.db.prepare(
      'INSERT INTO entities (name, entity_type) VALUES (?, ?)'
    ).run(name, entityType)
    return Number(info.lastInsertRowid)
  }

  private extractEntities(text: string): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    const add = (name: string): void => {
      const stripped = name.trim()
      if (stripped && stripped.length >= 2 && stripped.length <= 30
          && !seen.has(stripped.toLowerCase())) {
        seen.add(stripped.toLowerCase())
        result.push(stripped)
      }
    }

    // 英文实体
    for (const m of text.matchAll(RE_CAPITALIZED)) add(m[1])
    for (const m of text.matchAll(RE_DOUBLE_QUOTE)) add(m[1])
    for (const m of text.matchAll(RE_SINGLE_QUOTE)) add(m[1])
    for (const m of text.matchAll(RE_AKA)) { add(m[1]); add(m[2]) }

    // 中文实体：引号包裹
    for (const m of text.matchAll(RE_CN_QUOTED)) add(m[1])
    // 中文实体：书名号
    for (const m of text.matchAll(RE_CN_BOOK)) add(m[1])

    // 中文 bigram 关键词提取（2-4 字组合）
    const cnChars = text.match(/[\u4e00-\u9fff]+/g) ?? []
    for (const segment of cnChars) {
      for (let len = 2; len <= Math.min(4, segment.length); len++) {
        for (let i = 0; i <= segment.length - len; i++) {
          const candidate = segment.slice(i, i + len)
          if (!CN_STOP_WORDS.has(candidate)) {
            add(candidate)
          }
        }
      }
    }

    return result
  }

  private rowToFact(row: FactRow): Fact {
    return {
      factId: row.fact_id,
      content: row.content,
      category: row.category as FactCategory,
      tags: row.tags,
      trustScore: row.trust_score,
      retrievalCount: row.retrieval_count,
      helpfulCount: row.helpful_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
