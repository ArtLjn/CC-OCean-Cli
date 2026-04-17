import type { Message, UserMessage, AssistantMessage } from '../../types/message.js'
import { sideQuery } from '../../utils/sideQuery.js'
import { getDefaultHaikuModel } from '../../utils/model/model.js'

const SUMMARIZE_PROMPT = `你是一个对话总结助手。请将以下对话总结为一段简洁的知识片段。

要求：
1. 提取关键的技术决策、架构设计、问题解决方案
2. 包含重要的上下文信息（项目名、模块名、关键路径）
3. 控制在 100-200 字以内
4. 用中文输出

最后用一行输出标签，格式为: [tags: tag1, tag2, tag3]

对话内容：
{messages_text}

请直接输出总结内容，不要添加任何前缀。`

function extractTextFromMessage(msg: Message): string {
  // UserMessage: msg.message.content 是 string 或 content block 数组
  if (msg.type === 'user') {
    const userMsg = msg as UserMessage
    const content = userMsg.message?.content
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

  // AssistantMessage: msg.message?.content 可能是 string 或 content block 数组
  if (msg.type === 'assistant') {
    const asstMsg = msg as AssistantMessage
    const content = asstMsg.message?.content
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

export async function summarizeConversation(
  messages: Message[],
  signal?: AbortSignal,
): Promise<{ summary: string; tags: string[] }> {
  const textParts = messages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => {
      const text = extractTextFromMessage(m)
      if (!text) return null
      return `[${m.type}]: ${text}`
    })
    .filter((t): t is string => t !== null)

  const fullText = textParts.join('\n\n')
  if (fullText.length < 100) {
    return { summary: fullText.trim() || '（空会话）', tags: [] }
  }

  // 取最近的内容，避免超长
  const truncated = fullText.length > 8000 ? fullText.slice(-8000) : fullText

  const result = await sideQuery({
    model: getDefaultHaikuModel(),
    system: SUMMARIZE_PROMPT.replace('{messages_text}', truncated),
    messages: [{ role: 'user', content: '请总结以上对话。' }],
    max_tokens: 512,
    signal,
    querySource: 'memory_summarizer',
  })

  const text = result.content
    ?.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(b => b.text)
    .join('')
    .trim() ?? ''

  // 解析 [tags: ...] 行
  const tagsMatch = text.match(/\[tags:\s*([^\]]+)\]/i)
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : []

  // 去掉 tags 行得到纯 summary
  const summary = text.replace(/\[tags:\s*[^\]]+\]\s*/i, '').trim()

  return { summary, tags }
}

// 提炼式交接：用 LLM 提取关键信息，保留上下文但不冗余
const HANDOFF_PROMPT = `你是一个工作交接助手。请从以下对话中提炼出工作交接所需的关键信息。

要求输出 Markdown 格式，包含以下部分（按需，没有则省略）：

## 用户需求
列出用户的所有需求（去重）

## 关键结论
技术决策、架构选择、问题根因分析等

## 修改的文件
列出所有被修改/创建/删除的文件路径

## 代码变更摘要
关键代码变更的核心逻辑，只保留核心片段，不要粘贴大段代码

## 待办/遗留问题
未完成的工作、已知问题、后续计划

## 重要提示
需要下一位接手者注意的事项

最后用一行输出标签，格式为: [tags: tag1, tag2, tag3]

对话内容：
{messages_text}`

export async function extractHandoff(
  messages: Message[],
  signal?: AbortSignal,
): Promise<{ summary: string; tags: string[]; content: string }> {
  const textParts = messages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => {
      const text = extractTextFromMessage(m)
      if (!text) return null
      return `[${m.type}]: ${text}`
    })
    .filter((t): t is string => t !== null)

  const fullText = textParts.join('\n\n')
  if (fullText.length < 100) {
    const content = fullText.trim() || '（空会话）'
    return { summary: content, tags: [], content }
  }

  const truncated = fullText.length > 16000 ? fullText.slice(-16000) : fullText

  const result = await sideQuery({
    model: getDefaultHaikuModel(),
    system: HANDOFF_PROMPT.replace('{messages_text}', truncated),
    messages: [{ role: 'user', content: '请生成交接文档。' }],
    max_tokens: 2048,
    signal,
    querySource: 'memory_handoff',
  })

  const text = result.content
    ?.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(b => b.text)
    .join('')
    .trim() ?? ''

  const tagsMatch = text.match(/\[tags:\s*([^\]]+)\]/i)
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : []

  const content = text.replace(/\[tags:\s*[^\]]+\]\s*/i, '').trim()
  const summary = `工作交接: ${content.slice(0, 80).replace(/\n/g, ' ')}...`

  return { summary, tags: [...tags, 'handoff'], content }
}
