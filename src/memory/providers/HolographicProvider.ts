/**
 * SQLite 结构化事实存储 Provider（双层架构）。
 *
 * 全局库: ~/.claude/memory/facts.db — user_pref / tool / general
 * 项目库: {project}/.claude/memory/facts.db — project
 *
 * 职责：
 * - 管理双 SQLite facts 数据库
 * - 提供 fact_store / fact_feedback 工具
 * - prefetch 时执行跨库混合检索
 * - system prompt 注入 user_pref 快照
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { MemoryProvider } from '../MemoryProvider'
import { MemoryStore } from '../store/MemoryStore'
import { FactRetriever } from '../store/FactRetriever'
import { scanForInjection } from '../security'
import type { ToolSchema, ProviderContext, FactStoreArgs, FactFeedbackArgs, FactCategory, ScoredFact } from '../types'

// -- 工具 Schema 定义 --

const FACT_STORE_SCHEMA: ToolSchema = {
  name: 'fact_store',
  description: `结构化事实记忆系统（SQLite+FTS5 索引）。数据来自 memdir 的自动同步。

主要用途 — 检索已存储的事实：
- search — 关键词查找
- probe — 实体探测：关于某人/某事的所有事实
- related — 实体关联
- reason — 组合推理：同时关联多个实体的事实
- contradict — 矛盾检测
- list — 浏览事实

写入说明：
- add/update/remove 仍可用，但用户画像和偏好应通过 memdir 的 memory 系统写入
- memdir 写入会自动同步到此索引（onMemoryWrite 钩子）`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'search', 'probe', 'related', 'reason', 'contradict', 'update', 'remove', 'list'],
      },
      content: { type: 'string', description: "事实内容（'add' 必需）" },
      query: { type: 'string', description: "搜索查询（'search' 必需）" },
      entity: { type: 'string', description: "实体名（'probe'/'related' 使用）" },
      entities: { type: 'array', items: { type: 'string' }, description: "实体列表（'reason' 使用）" },
      fact_id: { type: 'number', description: "事实 ID（'update'/'remove' 使用）" },
      category: { type: 'string', enum: ['user_pref', 'project', 'tool', 'general'] },
      tags: { type: 'string', description: '逗号分隔标签' },
      trust_delta: { type: 'number', description: "'update' 的信任调整值" },
      min_trust: { type: 'number', description: '最低信任过滤（默认 0.3）' },
      limit: { type: 'number', description: '最大结果数（默认 10）' },
    },
    required: ['action'],
  },
}

const FACT_FEEDBACK_SCHEMA: ToolSchema = {
  name: 'fact_feedback',
  description: '使用事实后评分。标记 helpful 如果准确，unhelpful 如果过时。训练记忆系统 — 好事实上升，坏事实下降。',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['helpful', 'unhelpful'] },
      fact_id: { type: 'number', description: '要评分的事实 ID' },
    },
    required: ['action', 'fact_id'],
  },
}

export class HolographicProvider extends MemoryProvider {
  private globalStore: MemoryStore | null = null
  private projectStore: MemoryStore | null = null
  private globalRetriever: FactRetriever | null = null
  private projectRetriever: FactRetriever | null = null
  private minTrust = 0.3
  private projectRoot = ''

  get name(): string {
    return 'holographic'
  }

  isAvailable(): boolean {
    return true // SQLite 始终可用
  }

  initialize(ctx: ProviderContext): void {
    // 全局数据库：用户偏好跨项目持久化
    const globalHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    const globalDbPath = join(globalHome, 'memory', 'facts.db')
    this.globalStore = new MemoryStore(globalDbPath)
    this.globalRetriever = new FactRetriever(this.globalStore)

    // 项目数据库：项目知识跟随项目
    this.projectRoot = ctx.projectRoot
    const projectDbPath = join(ctx.projectRoot, '.claude', 'memory', 'facts.db')
    this.projectStore = new MemoryStore(projectDbPath)
    this.projectRetriever = new FactRetriever(this.projectStore)
  }

  /** 按 category 路由到对应 store */
  private routeStore(category?: FactCategory): MemoryStore {
    if (category === 'project' && this.projectStore) return this.projectStore
    return this.globalStore!
  }

  /** 根据 fact_id 判断属于哪个库（先查全局再查项目） */
  private storeForFactId(factId: number): MemoryStore | null {
    if (this.globalStore) {
      const row = this.globalStore.connection.prepare('SELECT fact_id FROM facts WHERE fact_id = ?').get(factId)
      if (row) return this.globalStore
    }
    if (this.projectStore) {
      const row = this.projectStore.connection.prepare('SELECT fact_id FROM facts WHERE fact_id = ?').get(factId)
      if (row) return this.projectStore
    }
    return null
  }

  systemPromptBlock(): string {
    const globalCount = this.globalStore?.getTotalCount() ?? 0
    const projectCount = this.projectStore?.getTotalCount() ?? 0

    if (globalCount === 0 && projectCount === 0) {
      return '# 结构化记忆\n事实库为空。使用 fact_store 存储和检索结构化事实。'
    }

    let block = '# 结构化记忆\n'
    if (globalCount > 0) block += `全局事实库 ${globalCount} 条（用户偏好等）。`
    if (projectCount > 0) block += `项目事实库 ${projectCount} 条（项目知识等）。`
    block += '\n\n**重要**：回答关于用户、项目、技术栈的问题时，先查 fact_store 再读文件。'
    block += '\n支持 search/probe/related/reason/contradict 操作。'

    // 注入 user_pref 快照
    const userPrefs = this.globalStore?.listFacts('user_pref', 0.0, 20) ?? []
    if (userPrefs.length > 0) {
      block += '\n\n## 用户信息\n'
      block += userPrefs.map(f => `- ${f.content}`).join('\n')
    }

    return block
  }

  prefetch(query: string): string {
    if (!query) return ''
    try {
      // 跨库搜索
      const globalResults = this.globalRetriever?.search(query, { minTrust: this.minTrust, limit: 3 }) ?? []
      const projectResults = this.projectRetriever?.search(query, { minTrust: this.minTrust, limit: 3 }) ?? []
      const all = [...globalResults, ...projectResults]
      if (all.length === 0) return ''

      // 安全过滤
      const safeResults = all.filter(r => {
        const scan = scanForInjection(r.content)
        return scan.safe
      })
      if (safeResults.length === 0) return ''

      const lines = safeResults.map(r =>
        `- [${r.trustScore.toFixed(1)}] ${r.content}`
      )
      return '## 结构化记忆\n' + lines.join('\n')
    } catch {
      return ''
    }
  }

  getToolSchemas(): ToolSchema[] {
    return [FACT_STORE_SCHEMA, FACT_FEEDBACK_SCHEMA]
  }

  handleToolCall(toolName: string, args: Record<string, unknown>): string {
    if (toolName === 'fact_store') return this.handleFactStore(args as unknown as FactStoreArgs)
    if (toolName === 'fact_feedback') return this.handleFactFeedback(args as unknown as FactFeedbackArgs)
    throw new Error(`Unknown tool: ${toolName}`)
  }

  shutdown(): void {
    this.globalStore?.close()
    this.projectStore?.close()
    this.globalStore = this.projectStore = null
    this.globalRetriever = this.projectRetriever = null
  }

  // -- 工具处理 ---

  private handleFactStore(args: FactStoreArgs): string {
    try {
      const action = args.action

      switch (action) {
        case 'add': {
          if (!args.content) return JSON.stringify({ error: "Missing required argument: content" })
          const store = this.routeStore(args.category)
          const category = args.category ?? 'general'

          // Upsert: 先检查语义相似，有则更新，无则新增
          const similar = store.findSimilarFact(args.content, category)
          if (similar) {
            // 合并更新：用新内容替换旧内容（新信息更完整）
            store.updateFact(similar.factId, {
              content: args.content,
              tags: args.tags,
              trustDelta: 0.05, // 确认更新，小幅提升信任
            })
            return JSON.stringify({ fact_id: similar.factId, status: 'updated', reason: 'similar_fact_merged' })
          }

          const factId = store.addFact(args.content, category, args.tags ?? '')
          return JSON.stringify({ fact_id: factId, status: 'added' })
        }

        case 'search': {
          if (!args.query) return JSON.stringify({ error: "Missing required argument: query" })
          const results: ScoredFact[] = []
          // 搜索全局库
          const globalResults = this.globalRetriever?.search(args.query, {
            category: args.category !== 'project' ? args.category : undefined,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          }) ?? []
          results.push(...globalResults)
          // 如果未指定 category 或指定了 project，也搜项目库
          if (!args.category || args.category === 'project') {
            const projectResults = this.projectRetriever?.search(args.query, {
              category: args.category === 'project' ? undefined : undefined,
              minTrust: args.min_trust ?? this.minTrust,
              limit: args.limit ?? 10,
            }) ?? []
            results.push(...projectResults)
          }
          // 去重并截断
          const seen = new Set<string>()
          const deduped = results.filter(r => {
            if (seen.has(r.content)) return false
            seen.add(r.content)
            return true
          })
          return JSON.stringify({ results: deduped.slice(0, args.limit ?? 10), count: deduped.length })
        }

        case 'probe': {
          if (!args.entity) return JSON.stringify({ error: "Missing required argument: entity" })
          const store = this.routeStore(args.category)
          const retriever = args.category === 'project' ? this.projectRetriever! : this.globalRetriever!
          const results = retriever.probe(args.entity, {
            category: undefined,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'related': {
          if (!args.entity) return JSON.stringify({ error: "Missing required argument: entity" })
          const retriever = args.category === 'project' ? this.projectRetriever! : this.globalRetriever!
          const results = retriever.related(args.entity, {
            category: undefined,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'reason': {
          const entities = args.entities ?? []
          if (entities.length === 0) return JSON.stringify({ error: "reason requires 'entities' list" })
          const retriever = args.category === 'project' ? this.projectRetriever! : this.globalRetriever!
          const results = retriever.reason(entities, {
            category: undefined,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'contradict': {
          const retriever = args.category === 'project' ? this.projectRetriever! : this.globalRetriever!
          const results = retriever.contradict({
            category: undefined,
            threshold: 0.3,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'update': {
          if (!args.fact_id) return JSON.stringify({ error: "Missing required argument: fact_id" })
          const store = this.storeForFactId(args.fact_id)
          if (!store) return JSON.stringify({ error: `fact_id ${args.fact_id} not found` })
          const updated = store.updateFact(args.fact_id, {
            content: args.content,
            tags: args.tags,
            category: args.category,
            trustDelta: args.trust_delta,
          })
          return JSON.stringify({ updated })
        }

        case 'remove': {
          if (!args.fact_id) return JSON.stringify({ error: "Missing required argument: fact_id" })
          const store = this.storeForFactId(args.fact_id)
          if (!store) return JSON.stringify({ error: `fact_id ${args.fact_id} not found` })
          const removed = store.removeFact(args.fact_id)
          return JSON.stringify({ removed })
        }

        case 'list': {
          const store = this.routeStore(args.category)
          const facts = store.listFacts(args.category, args.min_trust ?? 0.0, args.limit ?? 10)
          return JSON.stringify({ facts, count: facts.length })
        }

        default:
          return JSON.stringify({ error: `Unknown action: ${action}` })
      }
    } catch (err) {
      return JSON.stringify({ error: String(err) })
    }
  }

  private handleFactFeedback(args: FactFeedbackArgs): string {
    try {
      if (!args.fact_id) return JSON.stringify({ error: "Missing required argument: fact_id" })
      const store = this.storeForFactId(args.fact_id)
      if (!store) return JSON.stringify({ error: `fact_id ${args.fact_id} not found` })
      const result = store.recordFeedback(args.fact_id, args.action === 'helpful')
      return JSON.stringify(result)
    } catch (err) {
      return JSON.stringify({ error: String(err) })
    }
  }
}
