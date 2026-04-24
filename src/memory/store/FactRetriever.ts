/**
 * 混合检索管线。
 * 移植自 Hermes holographic/retrieval.py，去掉 HRR 向量。
 *
 * 管线：FTS5 候选集 → Jaccard 重排序 → 信任评分加权 → 时间衰减
 * 高级检索：probe/related/reason 基于 fact_entities 关联表
 * 矛盾检测：实体重叠 + 内容差异
 */

import type { Database } from 'bun:sqlite'
import type { Fact, FactCategory, ScoredFact, Contradiction, SearchOptions, ContradictOptions, RetrieverOptions } from '../types'
import { MemoryStore } from './MemoryStore'

interface FtsCandidate extends Fact {
  ftsRank: number
}

export class FactRetriever {
  private db: Database
  private ftsWeight: number
  private jaccardWeight: number
  private halfLifeDays: number

  constructor(
    private store: MemoryStore,
    options?: RetrieverOptions,
  ) {
    this.db = store.connection
    this.ftsWeight = options?.ftsWeight ?? 0.5
    this.jaccardWeight = options?.jaccardWeight ?? 0.5
    this.halfLifeDays = options?.temporalDecayHalfLife ?? 0
  }

  /** 主搜索：FTS5 → Jaccard → 信任评分 → 时间衰减 */
  search(query: string, options?: SearchOptions): ScoredFact[] {
    const minTrust = options?.minTrust ?? 0.3
    const limit = options?.limit ?? 10
    const category = options?.category

    // Stage 1: FTS5 候选集，空时 fallback 到 LIKE
    let candidates = this.ftsCandidates(query, category, minTrust, limit * 3)
    if (candidates.length === 0) {
      candidates = this.likeFallback(query, category, minTrust, limit * 3)
    }
    if (candidates.length === 0) {
      // Fallback: 仅对个人/身份相关的短查询触发（如"你是谁"、"我叫什么"）
      // 代码/技术查询（如"帮我重构"、"git commit"）不触发，避免 token 浪费
      if (this.isPersonalQuery(query)) {
        return this.trustFallback(category, minTrust, limit)
      }
      return []
    }

    // Stage 2-4: Jaccard 重排序 + 信任评分 + 时间衰减
    const queryTokens = this.tokenize(query)
    const scored: ScoredFact[] = []

    for (const fact of candidates) {
      const contentTokens = this.tokenize(fact.content)
      const tagTokens = this.tokenize(fact.tags)
      const allTokens = new Set([...contentTokens, ...tagTokens])

      const jaccard = this.jaccardSimilarity(queryTokens, allTokens)
      const ftsScore = fact.ftsRank

      // 综合评分
      const relevance = this.ftsWeight * ftsScore + this.jaccardWeight * jaccard
      let score = relevance * fact.trustScore

      // 时间衰减
      if (this.halfLifeDays > 0) {
        score *= this.temporalDecay(fact.updatedAt || fact.createdAt)
      }

      scored.push({ ...fact, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }

  /** 实体探测：查询某实体关联的所有事实 */
  probe(entity: string, options?: SearchOptions): ScoredFact[] {
    const limit = options?.limit ?? 10
    const facts = this.store.getFactsByEntity(entity, options?.category, limit)
    return facts.map((f, i) => ({
      ...f,
      score: f.trustScore * (1 - i * 0.05), // 按信任评分排序并给微小梯度
    }))
  }

  /** 实体关联：查找与某实体共享上下文的其他事实 */
  related(entity: string, options?: SearchOptions): ScoredFact[] {
    const limit = options?.limit ?? 10
    const category = options?.category

    // Step 1: 获取实体关联的 fact_id 列表
    let entityFactsSql = `
      SELECT fe.fact_id FROM fact_entities fe
      JOIN entities e ON fe.entity_id = e.entity_id
      WHERE e.name LIKE ?
    `
    const entityFactRows = this.db.prepare(entityFactsSql).all(entity) as Array<{ fact_id: number }>
    if (entityFactRows.length === 0) return []

    const factIds = entityFactRows.map(r => r.fact_id)

    // Step 2: 获取这些 facts 关联的其他实体
    const placeholders = factIds.map(() => '?').join(',')
    const otherEntityRows = this.db.prepare(`
      SELECT DISTINCT e.name FROM entities e
      JOIN fact_entities fe ON fe.entity_id = e.entity_id
      WHERE fe.fact_id IN (${placeholders})
        AND e.name NOT LIKE ?
    `).all(...factIds, entity) as Array<{ name: string }>

    if (otherEntityRows.length === 0) return []

    // Step 3: 获取关联这些其他实体但不包含原始事实的 facts
    const otherEntities = otherEntityRows.map(r => r.name)
    const entityPlaceholders = otherEntities.map(() => '?').join(',')
    const excludePlaceholders = factIds.map(() => '?').join(',')

    let categoryClause = ''
    const params: unknown[] = [...otherEntities, ...factIds]
    if (category) {
      categoryClause = 'AND f.category = ?'
      params.push(category)
    }
    params.push(limit)

    const sql = `
      SELECT DISTINCT f.fact_id, f.content, f.category, f.tags,
             f.trust_score, f.retrieval_count, f.helpful_count,
             f.created_at, f.updated_at
      FROM facts f
      JOIN fact_entities fe ON f.fact_id = fe.fact_id
      JOIN entities e ON fe.entity_id = e.entity_id
      WHERE e.name IN (${entityPlaceholders})
        AND f.fact_id NOT IN (${excludePlaceholders})
        ${categoryClause}
      ORDER BY f.trust_score DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params) as Array<{
      fact_id: number; content: string; category: string; tags: string;
      trust_score: number; retrieval_count: number; helpful_count: number;
      created_at: string; updated_at: string;
    }>

    return rows.map((r, i) => ({
      factId: r.fact_id,
      content: r.content,
      category: r.category as FactCategory,
      tags: r.tags,
      trustScore: r.trust_score,
      retrievalCount: r.retrieval_count,
      helpfulCount: r.helpful_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      score: r.trust_score * (1 - i * 0.05),
    }))
  }

  /** 多实体推理：查找同时关联多个实体的事实 */
  reason(entities: string[], options?: SearchOptions): ScoredFact[] {
    if (entities.length === 0) return []
    const facts = this.store.getFactsByEntities(entities, options?.category, options?.limit ?? 10)
    return facts.map((f, i) => ({
      ...f,
      score: f.trustScore * (1 - i * 0.05),
    }))
  }

  /** 矛盾检测：实体重叠 + 内容差异 */
  contradict(options?: ContradictOptions): Contradiction[] {
    const threshold = options?.threshold ?? 0.3
    const limit = options?.limit ?? 10
    const category = options?.category

    // 获取事实
    let whereClause = ''
    const params: unknown[] = []
    if (category) {
      whereClause = 'WHERE f.category = ?'
      params.push(category)
    }

    let rows = this.db.prepare(`
      SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score,
             f.created_at, f.updated_at
      FROM facts f
      ${whereClause}
      ORDER BY f.updated_at DESC
    `).all(...params) as Array<{
      fact_id: number; content: string; category: string; tags: string;
      trust_score: number; created_at: string; updated_at: string;
    }>

    if (rows.length < 2) return []

    // 限制 O(n²) 复杂度
    const MAX_FACTS = 500
    if (rows.length > MAX_FACTS) rows = rows.slice(0, MAX_FACTS)

    // 构建实体集合
    const factEntities = new Map<number, Set<string>>()
    for (const row of rows) {
      const names = this.store.getEntitiesForFact(row.fact_id)
      factEntities.set(row.fact_id, new Set(names.map(n => n.toLowerCase())))
    }

    // 比对所有事实对
    const contradictions: Contradiction[] = []
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const f1 = rows[i]
        const f2 = rows[j]
        const ents1 = factEntities.get(f1.fact_id) ?? new Set()
        const ents2 = factEntities.get(f2.fact_id) ?? new Set()

        if (ents1.size === 0 || ents2.size === 0) continue

        // 实体重叠 (Jaccard)
        const intersection = new Set([...ents1].filter(e => ents2.has(e)))
        const union = new Set([...ents1, ...ents2])
        const entityOverlap = union.size > 0 ? intersection.size / union.size : 0

        if (entityOverlap < 0.3) continue

        // 内容相似度 (Jaccard on tokens)
        const tokens1 = this.tokenize(f1.content)
        const tokens2 = this.tokenize(f2.content)
        const contentSim = this.jaccardSimilarity(tokens1, tokens2)

        // 高实体重叠 + 低内容相似度 = 潜在矛盾
        const contradictionScore = entityOverlap * (1 - contentSim)

        if (contradictionScore >= threshold) {
          const toFact = (r: typeof rows[0]): Fact => ({
            factId: r.fact_id,
            content: r.content,
            category: r.category as FactCategory,
            tags: r.tags,
            trustScore: r.trust_score,
            retrievalCount: 0,
            helpfulCount: 0,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })

          contradictions.push({
            factA: toFact(f1),
            factB: toFact(f2),
            entityOverlap: Math.round(entityOverlap * 1000) / 1000,
            contentSimilarity: Math.round(contentSim * 1000) / 1000,
            contradictionScore: Math.round(contradictionScore * 1000) / 1000,
            sharedEntities: [...intersection],
          })
        }
      }
    }

    contradictions.sort((a, b) => b.contradictionScore - a.contradictionScore)
    return contradictions.slice(0, limit)
  }

  // ------------------------------------------------------------------
  // 内部方法
  // ------------------------------------------------------------------

  /** Stage 1: FTS5 候选集 */
  private ftsCandidates(
    query: string,
    category: FactCategory | undefined,
    minTrust: number,
    limit: number,
  ): FtsCandidate[] {
    // 将空格分隔的查询词用 OR 连接，提升召回率
    const ftsQuery = query.split(/\s+/).filter(w => w.length > 0).join(' OR ')
    if (!ftsQuery) return []

    const params: unknown[] = [ftsQuery, minTrust]
    const whereClauses = ['facts_fts MATCH ?', 'f.trust_score >= ?']

    if (category) {
      whereClauses.push('f.category = ?')
      params.push(category)
    }
    params.push(limit)

    const whereSql = whereClauses.join(' AND ')

    const sql = `
      SELECT f.*, facts_fts.rank as fts_rank_raw
      FROM facts_fts
      JOIN facts f ON f.fact_id = facts_fts.rowid
      WHERE ${whereSql}
      ORDER BY facts_fts.rank
      LIMIT ?
    `

    let rows: Array<Record<string, unknown>>
    try {
      rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    } catch {
      // FTS5 MATCH 可能在格式错误的查询上失败 — fallback 到 LIKE
      return this.likeFallback(query, category, minTrust, limit)
    }

    if (rows.length === 0) return []

    // 归一化 FTS5 rank: rank 是负数，越小越好
    const rawRanks = rows.map(r => Math.abs(Number(r.fts_rank_raw)))
    const maxRank = Math.max(...rawRanks, 1e-6)

    return rows.map((row, i) => ({
      factId: Number(row.fact_id),
      content: String(row.content),
      category: String(row.category) as FactCategory,
      tags: String(row.tags),
      trustScore: Number(row.trust_score),
      retrievalCount: Number(row.retrieval_count),
      helpfulCount: Number(row.helpful_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ftsRank: rawRanks[i] / maxRank,
    }))
  }

  /** 简单分词：空格分割 + 去标点 + 小写 */
  private tokenize(text: string): Set<string> {
    if (!text) return new Set()
    const tokens = new Set<string>()
    for (const word of text.toLowerCase().split(/\s+/)) {
      const cleaned = word.replace(/[.,;:!?"'(){}[\]#@<>]/g, '')
      if (cleaned) tokens.add(cleaned)
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

  /** 时间衰减: 0.5^(ageDays / halfLifeDays) */
  private temporalDecay(timestampStr: string | null): number {
    if (!this.halfLifeDays || !timestampStr) return 1.0

    try {
      const ts = new Date(timestampStr + 'Z') // SQLite datetime 是 UTC
      const ageMs = Date.now() - ts.getTime()
      const ageDays = ageMs / 86400000
      if (ageDays < 0) return 1.0
      return Math.pow(0.5, ageDays / this.halfLifeDays)
    } catch {
      return 1.0
    }
  }

  /** 判断查询是否为个人/身份相关（应触发 trust fallback） */
  private isPersonalQuery(query: string): boolean {
    const q = query.trim().toLowerCase()
    // 短查询（<=10字）+ 包含个人/身份关键词
    if (q.length > 10) return false
    const PERSONAL_KEYWORDS = [
      // 中文
      '你是谁', '我是谁', '我叫', '名字', '认识', '知道我', '我的',
      '记住', '记得', '暖暖', '关于我', '我喜欢', '我偏好',
      // 英文
      'who are you', 'who am i', 'my name', 'remember me', 'about me',
      'my preference', 'i prefer', 'i like',
    ]
    return PERSONAL_KEYWORDS.some(kw => q.includes(kw))
  }

  /** Trust fallback — 查询无法匹配任何事实时，按信任评分返回 top-N */
  private trustFallback(
    category: FactCategory | undefined,
    minTrust: number,
    limit: number,
  ): ScoredFact[] {
    const facts = this.store.listFacts(category, minTrust, limit)
    return facts.map((f, i) => ({
      ...f,
      score: f.trustScore * (1 - i * 0.05),
    }))
  }

  /** LIKE fallback — FTS5 失败或中文查询时使用 */
  private likeFallback(
    query: string,
    category: FactCategory | undefined,
    minTrust: number,
    limit: number,
  ): FtsCandidate[] {
    const words = query.split(/\s+/).filter(w => w.length > 0)
    if (words.length === 0) return []

    // 对每个词做 LIKE 匹配，取并集
    const conditions = words.map(() => '(f.content LIKE ? OR f.tags LIKE ?)').join(' OR ')
    const params: unknown[] = []
    for (const word of words) {
      params.push(`%${word}%`, `%${word}%`)
    }

    params.push(minTrust)
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
      WHERE (${conditions})
        AND f.trust_score >= ?
        ${categoryClause}
      ORDER BY f.trust_score DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params) as Array<{
      fact_id: number; content: string; category: string; tags: string;
      trust_score: number; retrieval_count: number; helpful_count: number;
      created_at: string; updated_at: string;
    }>

    // LIKE 没有排名，给统一的中间排名
    return rows.map(r => ({
      factId: r.fact_id,
      content: r.content,
      category: r.category as FactCategory,
      tags: r.tags,
      trustScore: r.trust_score,
      retrievalCount: r.retrieval_count,
      helpfulCount: r.helpful_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ftsRank: 0.5,
    }))
  }
}
