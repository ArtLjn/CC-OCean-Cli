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

const DESCRIPTION = `结构化事实记忆系统，用于存储和检索关于用户、项目、工具的持久化事实。

WHEN TO SAVE（主动执行，不要等用户要求）：
- 用户说"记住"、"别忘了"、"记住我叫..."等明确要求
- 用户分享了个人信息（姓名、角色、偏好、习惯、关系）
- 用户纠正你或说"不要这样做"
- 你发现了环境、项目、工具的稳定事实

WHEN TO RETRIEVE：
- 回答关于用户的问题时，先 probe 或 reason
- 需要了解用户偏好时，先 search

操作：
- add — 存储事实（category: user_pref=用户偏好, project=项目事实, tool=工具知识, general=通用）
- search — 关键词查找
- probe — 实体探测：关于某人/某事的所有事实
- related — 实体关联
- reason — 组合推理：同时关联多个实体的事实
- contradict — 矛盾检测
- update/remove/list — CRUD`

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
