/**
 * fact_feedback 工具 — 事实评分反馈。
 * 暴露 HolographicProvider 的 fact_feedback 工具给模型。
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getMemoryManager } from '../../memory/instance.js'

const FACT_FEEDBACK_TOOL_NAME = 'fact_feedback'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['helpful', 'unhelpful']),
    fact_id: z.number().describe('要评分的事实 ID'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    result: z.string().describe('JSON-encoded result'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION = `使用事实后评分。标记 helpful 如果准确，unhelpful 如果过时。
训练记忆系统 — 好事实上升，坏事实下降。`

export const FactFeedbackTool = buildTool({
  name: FACT_FEEDBACK_TOOL_NAME,
  searchHint: 'rate memory fact helpfulness',
  maxResultSizeChars: 10_000,
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
    if (!manager || !manager.hasTool(FACT_FEEDBACK_TOOL_NAME)) {
      return {
        data: { error: '结构化记忆不可用' },
        result: JSON.stringify({ error: 'Memory not available' }),
      }
    }
    const result = manager.handleToolCall(FACT_FEEDBACK_TOOL_NAME, input as Record<string, unknown>)
    return { data: JSON.parse(result), result }
  },
  isConcurrencySafe() { return true },
  isReadOnly() { return false },
  userFacingName() { return 'Memory Feedback' },
  getActivityDescription(input) {
    return input.action === 'helpful' ? 'Rating fact helpful' : 'Rating fact unhelpful'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: typeof output === 'string' ? output : JSON.stringify(output),
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
