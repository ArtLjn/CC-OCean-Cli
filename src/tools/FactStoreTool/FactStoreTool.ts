/**
 * fact_store 工具 — 结构化事实记忆系统。
 * 暴露 HolographicProvider 的 fact_store 工具给模型。
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getMemoryManager } from '../../memory/instance.js'

const FACT_STORE_TOOL_NAME = 'fact_store'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum([
      'add', 'search', 'probe', 'related', 'reason',
      'contradict', 'update', 'remove', 'list',
    ]).describe('要执行的操作'),
    content: z.string().optional().describe("事实内容（'add' 必需）"),
    query: z.string().optional().describe("搜索查询（'search' 必需）"),
    entity: z.string().optional().describe("实体名（'probe'/'related' 使用）"),
    entities: z.array(z.string()).optional().describe("实体列表（'reason' 使用）"),
    fact_id: z.number().optional().describe("事实 ID（'update'/'remove' 使用）"),
    category: z.enum(['user_pref', 'project', 'tool', 'general']).optional(),
    tags: z.string().optional().describe('逗号分隔标签'),
    trust_delta: z.number().optional().describe("'update' 的信任调整值"),
    min_trust: z.number().optional().describe('最低信任过滤（默认 0.3）'),
    limit: z.number().optional().describe('最大结果数（默认 10）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    result: z.string().describe('JSON-encoded result'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION = `结构化事实记忆系统（SQLite+FTS5 索引）。支持读写。

双层存储：
- 全局库：用户偏好/工具信息（跨项目共享）
- 项目库：项目知识（跟随项目）

操作：
- search — 关键词查找
- probe — 实体探测：关于某人/某事的所有事实
- related — 实体关联
- reason — 组合推理：同时关联多个实体的事实
- contradict — 矛盾检测
- list — 浏览事实
- add — 添加新事实（自动去重，相似则更新）
- update — 更新已有事实
- remove — 删除事实

写入时先 search 检查是否已存在相似事实。user_pref/tool/general → 全局库，project → 项目库。`

export const FactStoreTool = buildTool({
  name: FACT_STORE_TOOL_NAME,
  searchHint: 'structured fact memory with entity reasoning',
  maxResultSizeChars: 50_000,
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async call(input: z.infer<InputSchema>) {
    const manager = getMemoryManager()
    if (!manager || !manager.hasTool(FACT_STORE_TOOL_NAME)) {
      return {
        data: { error: '结构化记忆不可用' },
        result: JSON.stringify({ error: 'Memory not available' }),
      }
    }
    const result = manager.handleToolCall(FACT_STORE_TOOL_NAME, input as Record<string, unknown>)
    return { data: JSON.parse(result), result }
  },
  isConcurrencySafe() { return true },
  isReadOnly() { return false },
  userFacingName() { return 'Memory' },
  getActivityDescription(input) {
    const action = input.action ?? 'add'
    const descriptions: Record<string, string> = {
      add: 'Saving memory',
      search: 'Searching memories',
      probe: 'Probing entity',
      related: 'Finding related facts',
      reason: 'Reasoning across entities',
      contradict: 'Checking contradictions',
      update: 'Updating fact',
      remove: 'Removing fact',
      list: 'Listing facts',
    }
    return descriptions[action] ?? 'Memory operation'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: typeof output === 'string' ? output : JSON.stringify(output),
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
