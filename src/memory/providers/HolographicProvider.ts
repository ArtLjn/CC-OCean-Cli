/**
 * SQLite 结构化事实存储 Provider。
 * 移植自 Hermes HolographicMemoryProvider。
 *
 * 职责：
 * - 管理 SQLite facts 数据库
 * - 提供 fact_store / fact_feedback 工具
 * - prefetch 时执行混合检索
 * - 会话结束时自动提取事实
 * - 镜像 memdir 写入
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { MemoryProvider } from '../MemoryProvider'
import { MemoryStore } from '../store/MemoryStore'
import { FactRetriever } from '../store/FactRetriever'
import { scanForInjection } from '../security'
import type { ToolSchema, ProviderContext, FactStoreArgs, FactFeedbackArgs, FactCategory } from '../types'

// -- 工具 Schema 定义 --

const FACT_STORE_SCHEMA: ToolSchema = {
  name: 'fact_store',
  description: `结构化事实记忆系统。与 memdir 并行使用 — memdir 用于持久文件记忆，fact_store 用于结构化深度检索。

操作（简单 → 强大）：
- add — 存储用户期望被记住的事实
- search — 关键词查找
- probe — 实体探测：关于某人/某事的所有事实
- related — 实体关联：与某实体有结构连接的事实
- reason — 组合推理：同时关联多个实体的事实
- contradict — 记忆卫生：发现矛盾事实
- update/remove/list — CRUD

重要：回答关于用户的问题时，先 probe 或 reason。`,
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
  private store: MemoryStore | null = null
  private retriever: FactRetriever | null = null
  private minTrust = 0.3

  get name(): string {
    return 'holographic'
  }

  isAvailable(): boolean {
    return true // SQLite 始终可用
  }

  initialize(ctx: ProviderContext): void {
    // 全局数据库：跟 Hermes 一致，用户偏好跨项目持久化
    const globalHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    const dbPath = join(globalHome, 'memory', 'facts.db')
    this.store = new MemoryStore(dbPath)
    this.retriever = new FactRetriever(this.store)
  }

  systemPromptBlock(): string {
    if (!this.store) return ''
    const total = this.store.getTotalCount()
    if (total === 0) {
      return (
        '# 结构化记忆\n' +
        '活跃。事实库为空 — 主动使用 fact_store 工具存储用户希望被记住的结构化事实。\n' +
        '使用 fact_feedback 对使用过的事实评分（训练信任分数）。'
      )
    }
    return (
      `# 结构化记忆\n` +
      `活跃。已存储 ${total} 条事实，支持实体解析和信任评分。\n` +
      `使用 fact_store 搜索、探测实体、跨实体推理或添加事实。\n` +
      `使用 fact_feedback 对使用过的事实评分（训练信任分数）。`
    )
  }

  prefetch(query: string): string {
    if (!this.retriever || !query) return ''
    try {
      const results = this.retriever.search(query, { minTrust: this.minTrust, limit: 5 })
      if (results.length === 0) return ''

      // 安全过滤
      const safeResults = results.filter(r => {
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

  onSessionEnd(messages: Array<{ role: string; content: string }>): void {
    if (!this.store || !messages.length) return
    this.autoExtractFacts(messages)
  }

  onMemoryWrite(action: string, target: string, content: string): void {
    if (action === 'add' && this.store && content) {
      try {
        const category = target === 'user' ? 'user_pref' : 'general'
        this.store.addFact(content, category)
      } catch {
        // 去重冲突，忽略
      }
    }
  }

  shutdown(): void {
    this.store?.close()
    this.store = null
    this.retriever = null
  }

  // -- 工具处理 ---

  private handleFactStore(args: FactStoreArgs): string {
    try {
      const action = args.action
      const store = this.store!
      const retriever = this.retriever!

      switch (action) {
        case 'add': {
          if (!args.content) return JSON.stringify({ error: "Missing required argument: content" })
          const factId = store.addFact(
            args.content,
            args.category ?? 'general',
            args.tags ?? '',
          )
          return JSON.stringify({ fact_id: factId, status: 'added' })
        }

        case 'search': {
          if (!args.query) return JSON.stringify({ error: "Missing required argument: query" })
          const results = retriever.search(args.query, {
            category: args.category,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'probe': {
          if (!args.entity) return JSON.stringify({ error: "Missing required argument: entity" })
          const results = retriever.probe(args.entity, {
            category: args.category,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'related': {
          if (!args.entity) return JSON.stringify({ error: "Missing required argument: entity" })
          const results = retriever.related(args.entity, {
            category: args.category,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'reason': {
          const entities = args.entities ?? []
          if (entities.length === 0) return JSON.stringify({ error: "reason requires 'entities' list" })
          const results = retriever.reason(entities, {
            category: args.category,
            minTrust: args.min_trust ?? this.minTrust,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'contradict': {
          const results = retriever.contradict({
            category: args.category,
            threshold: 0.3,
            limit: args.limit ?? 10,
          })
          return JSON.stringify({ results, count: results.length })
        }

        case 'update': {
          if (!args.fact_id) return JSON.stringify({ error: "Missing required argument: fact_id" })
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
          const removed = store.removeFact(args.fact_id)
          return JSON.stringify({ removed })
        }

        case 'list': {
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
      const result = this.store!.recordFeedback(args.fact_id, args.action === 'helpful')
      return JSON.stringify(result)
    } catch (err) {
      return JSON.stringify({ error: String(err) })
    }
  }

  // -- 自动提取 ---

  private autoExtractFacts(messages: Array<{ role: string; content: string }>): void {
    const PREF_PATTERNS = [
      // 英文
      /\bI\s+(?:prefer|like|love|use|want|need)\s+(.+)/i,
      /\bmy\s+(?:favorite|preferred|default)\s+\w+\s+is\s+(.+)/i,
      /\bI\s+(?:always|never|usually)\s+(.+)/i,
      // 中文
      /我(?:叫|是)\s*(.+)/,
      /记住[我他她它]?(?:叫|是|的|名|叫名)?\s*(.+)/,
      /别?忘[了记]\s*(.+)/,
      /我(?:喜欢|偏好|习惯|常用|默认)\s*(.+)/,
      /我(?:的)?(?:名字|姓|角色|职业|工作)\s*(?:是|叫)\s*(.+)/,
    ]
    const DECISION_PATTERNS = [
      /\bwe\s+(?:decided|agreed|chose)\s+(?:to\s+)?(.+)/i,
      /\bthe\s+project\s+(?:uses|needs|requires)\s+(.+)/i,
      /项目(?:使用|需要|采用)\s*(.+)/,
      /(?:决定|约定|规范)(?:使用|用|是)\s*(.+)/,
    ]

    let extracted = 0
    for (const msg of messages) {
      if (msg.role !== 'user') continue
      const content = msg.content
      if (typeof content !== 'string' || content.length < 10) continue

      for (const pattern of PREF_PATTERNS) {
        if (pattern.test(content)) {
          try {
            this.store!.addFact(content.slice(0, 400), 'user_pref')
            extracted++
          } catch {
            // 去重冲突
          }
          break
        }
      }

      for (const pattern of DECISION_PATTERNS) {
        if (pattern.test(content)) {
          try {
            this.store!.addFact(content.slice(0, 400), 'project')
            extracted++
          } catch {
            // 去重冲突
          }
          break
        }
      }
    }

    if (extracted > 0) {
      console.log(`[HolographicProvider] 自动提取 ${extracted} 条事实`)
    }
  }
}
