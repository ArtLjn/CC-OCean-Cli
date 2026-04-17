import type { Message, UserMessage, AssistantMessage } from '../../types/message.js'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import { sideQuery } from '../../utils/sideQuery.js'
import {
  isCustomProviderModel,
  getCustomProviderForModel,
  resolveCustomModelApiKey,
} from '../../utils/model/customProviders.js'
import type { AgentConfig, AgentResult, MergeStrategy, OutputFormat } from './types.js'

// ── 消息文本提取（复用 summarizer 模式） ──

function extractTextFromMessage(msg: Message): string {
  if (msg.type === 'user') {
    const content = (msg as UserMessage).message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(
          (block): block is { type: string; text?: string } =>
            block.type === 'text' && typeof block.text === 'string',
        )
        .map(b => b.text!)
        .join('\n')
    }
  }

  if (msg.type === 'assistant') {
    const content = (msg as AssistantMessage).message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(
          (block): block is { type: string; text?: string } =>
            block.type === 'text' && typeof block.text === 'string',
        )
        .map(b => b.text!)
        .join('\n')
    }
  }

  return ''
}

// ── 自定义 Provider 非流式调用 ──

async function queryCustomProviderSimple(options: {
  model: string
  system: string
  messages: MessageParam[]
  maxTokens: number
  signal: AbortSignal
}): Promise<string> {
  const parsed = getCustomProviderForModel(options.model)
  if (!parsed) throw new Error(`未知的自定义 provider 模型: ${options.model}`)

  const { config, modelId } = parsed
  const apiKey = resolveCustomModelApiKey(config)
  if (!apiKey) {
    throw new Error(
      `未找到 ${config.name} 的 API Key。请设置 ${config.apiKeyEnv} 环境变量或在 custom-providers.json 中配置 apiKey`,
    )
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({
    apiKey,
    baseURL: config.baseUrl,
    ...(config.headers ? { defaultHeaders: config.headers } : {}),
    maxRetries: 2,
  })

  const response = await client.messages.create(
    {
      model: modelId,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: options.messages,
    },
    { signal: options.signal },
  )

  return response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

// ── 官方模型调用 ──

async function queryOfficialModel(options: {
  model: string
  system: string
  messages: MessageParam[]
  maxTokens: number
  signal: AbortSignal
}): Promise<string> {
  const response = await sideQuery({
    model: options.model,
    system: options.system,
    messages: options.messages,
    max_tokens: options.maxTokens,
    signal: options.signal,
    querySource: 'multi_agent',
  })

  return response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

// ── 统一入口 ──

async function queryAgentModel(
  agent: AgentConfig,
  userMessages: MessageParam[],
  signal: AbortSignal,
): Promise<string> {
  if (isCustomProviderModel(agent.model)) {
    return queryCustomProviderSimple({
      model: agent.model,
      system: agent.systemPrompt,
      messages: userMessages,
      maxTokens: agent.maxTokens,
      signal,
    })
  }

  return queryOfficialModel({
    model: agent.model,
    system: agent.systemPrompt,
    messages: userMessages,
    maxTokens: agent.maxTokens,
    signal,
  })
}

// ── 消息构建 ──

function buildMessagesFromContext(
  contextMessages: Message[],
  maxMessages: number = 20,
): MessageParam[] {
  const recent = contextMessages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .slice(-maxMessages)
    .map(m => {
      const text = extractTextFromMessage(m)
      if (!text) return null
      return { role: m.type === 'user' ? 'user' as const : 'assistant' as const, content: text }
    })
    .filter((m): m is MessageParam => m !== null)

  return recent
}

// ── 并行执行 ──

async function executeParallel(
  agents: AgentConfig[],
  messages: MessageParam[],
  signal: AbortSignal,
): Promise<AgentResult[]> {
  const results = await Promise.allSettled(
    agents.map(async agent => {
      const start = Date.now()
      const output = await queryAgentModel(agent, messages, signal)
      return {
        agent,
        output,
        success: true,
        durationMs: Date.now() - start,
      } satisfies AgentResult
    }),
  )

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    return {
      agent: agents[i],
      output: '',
      success: false,
      error: result.reason?.message ?? '未知错误',
      durationMs: 0,
    } satisfies AgentResult
  })
}

// ── 顺序执行 ──

async function executeSequential(
  agents: AgentConfig[],
  initialMessages: MessageParam[],
  signal: AbortSignal,
): Promise<AgentResult[]> {
  const results: AgentResult[] = []
  let currentMessages = [...initialMessages]

  for (const agent of agents) {
    const start = Date.now()
    try {
      const output = await queryAgentModel(agent, currentMessages, signal)
      results.push({
        agent,
        output,
        success: true,
        durationMs: Date.now() - start,
      })
      // 将当前 agent 输出作为 assistant 消息，供下个 agent 参考
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: `[${agent.name}]:\n${output}` },
      ]
    } catch (err) {
      results.push({
        agent,
        output: '',
        success: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      })
    }
  }

  return results
}

// ── 执行调度 ──

export async function executeAgents(options: {
  agents: AgentConfig[]
  contextMessages: Message[]
  userQuery?: string
  strategy: MergeStrategy
  signal: AbortSignal
}): Promise<AgentResult[]> {
  const { agents, contextMessages, userQuery, strategy, signal } = options

  let baseMessages = buildMessagesFromContext(contextMessages)
  if (userQuery) {
    baseMessages.push({ role: 'user', content: userQuery })
  }

  if (strategy === 'sequential') {
    return executeSequential(agents, baseMessages, signal)
  }
  return executeParallel(agents, baseMessages, signal)
}

// ── 结果合并 ──

const ROLE_ICONS: Record<string, string> = {
  architect: '🔷',
  reviewer: '🟡',
  implementer: '🟢',
  tester: '🟣',
  devops: '🔵',
  custom: '⚪',
}

function roleIcon(role: string): string {
  return ROLE_ICONS[role] ?? '⚪'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function mergeResults(results: AgentResult[], format: OutputFormat): string {
  const lines: string[] = []

  for (const result of results) {
    const icon = roleIcon(result.agent.role)
    const status = result.success ? '' : ' ❌'
    const header = `${icon} **${result.agent.name}** (\`${result.agent.model}\`) ${formatDuration(result.durationMs)}${status}`

    lines.push('╭──────────────────────────────────────╮')
    lines.push(`│ ${header}`)
    lines.push('├──────────────────────────────────────┤')

    if (!result.success) {
      lines.push(`│ Error: ${result.error}`)
    } else if (format === 'summary') {
      const text =
        result.output.length > 500 ? result.output.slice(0, 500) + '\n...(truncated)' : result.output
      lines.push(text.split('\n').map(l => `│ ${l}`).join('\n'))
    } else {
      lines.push(result.output.split('\n').map(l => `│ ${l}`).join('\n'))
    }

    lines.push('╰──────────────────────────────────────╯')
    lines.push('')
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0)
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push(`${successCount} 成功 / ${failCount} 失败 | 总耗时 ${formatDuration(totalTime)}`)

  return lines.join('\n')
}
