/**
 * 记忆系统编排器。
 * 移植自 Hermes MemoryManager，管理 builtin + 至多一个外部 provider。
 *
 * 约束：
 * - builtin provider 永远在线
 * - 至多一个外部 provider（防止工具 schema 膨胀）
 * - 单个 provider 失败不阻塞其他
 */

import { MemoryProvider } from './MemoryProvider'
import type { ToolSchema, ProviderContext } from './types'

export class MemoryManager {
  private providers: MemoryProvider[] = []
  private toolToProvider: Map<string, MemoryProvider> = new Map()
  private hasExternal = false

  /** 注册 provider。builtin 总被接受，外部 provider 至多一个 */
  addProvider(provider: MemoryProvider): void {
    const isBuiltin = provider.name === 'builtin'

    if (!isBuiltin) {
      if (this.hasExternal) {
        const existing = this.providers.find(p => p.name !== 'builtin')?.name ?? 'unknown'
        console.warn(
          `[MemoryManager] 拒绝外部 provider '${provider.name}'，` +
          `已有外部 provider '${existing}'。仅允许一个外部 provider。`
        )
        return
      }
      this.hasExternal = true
    }

    this.providers.push(provider)

    // 索引工具名 → provider
    for (const schema of provider.getToolSchemas()) {
      if (schema.name && !this.toolToProvider.has(schema.name)) {
        this.toolToProvider.set(schema.name, provider)
      } else if (schema.name) {
        console.warn(
          `[MemoryManager] 工具名冲突: '${schema.name}' 已被注册，忽略`
        )
      }
    }
  }

  /** 获取所有 provider */
  getProviders(): MemoryProvider[] {
    return [...this.providers]
  }

  // -- System Prompt ---

  /** 收集所有 provider 的 system prompt 块 */
  buildSystemPrompt(): string {
    const blocks: string[] = []
    for (const provider of this.providers) {
      try {
        const block = provider.systemPromptBlock()
        if (block?.trim()) blocks.push(block)
      } catch (err) {
        console.warn(`[MemoryManager] ${provider.name}.systemPromptBlock 失败:`, err)
      }
    }
    return blocks.join('\n\n')
  }

  // -- Prefetch ---

  /** 收集所有 provider 的 prefetch 结果 */
  prefetchAll(query: string): string {
    const parts: string[] = []
    for (const provider of this.providers) {
      try {
        const result = provider.prefetch(query)
        if (result?.trim()) parts.push(result)
      } catch (err) {
        // prefetch 失败不阻塞
      }
    }
    return parts.join('\n\n')
  }

  // -- Sync ---

  /** 同步一轮完成到所有 provider */
  syncAll(userContent: string, assistantContent: string): void {
    for (const provider of this.providers) {
      try {
        provider.syncTurn(userContent, assistantContent)
      } catch (err) {
        console.warn(`[MemoryManager] ${provider.name}.syncTurn 失败:`, err)
      }
    }
  }

  // -- Tools ---

  /** 收集所有 provider 的工具 schema */
  getAllToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = []
    const seen = new Set<string>()
    for (const provider of this.providers) {
      try {
        for (const schema of provider.getToolSchemas()) {
          if (schema.name && !seen.has(schema.name)) {
            schemas.push(schema)
            seen.add(schema.name)
          }
        }
      } catch (err) {
        console.warn(`[MemoryManager] ${provider.name}.getToolSchemas 失败:`, err)
      }
    }
    return schemas
  }

  /** 检查是否有 provider 处理指定工具 */
  hasTool(toolName: string): boolean {
    return this.toolToProvider.has(toolName)
  }

  /** 路由工具调用到对应 provider */
  handleToolCall(toolName: string, args: Record<string, unknown>): string {
    const provider = this.toolToProvider.get(toolName)
    if (!provider) {
      return JSON.stringify({ error: `No memory provider handles tool '${toolName}'` })
    }
    try {
      return provider.handleToolCall(toolName, args)
    } catch (err) {
      console.error(`[MemoryManager] ${provider.name}.handleToolCall(${toolName}) 失败:`, err)
      return JSON.stringify({ error: `Memory tool '${toolName}' failed: ${err}` })
    }
  }

  // -- Lifecycle ---

  /** 初始化所有 provider */
  initializeAll(ctx: ProviderContext): void {
    for (const provider of this.providers) {
      try {
        provider.initialize(ctx)
      } catch (err) {
        console.warn(`[MemoryManager] ${provider.name}.initialize 失败:`, err)
      }
    }
  }

  /** 通知所有 provider 会话结束 */
  onSessionEnd(messages: Array<{ role: string; content: string }>): void {
    for (const provider of this.providers) {
      try {
        provider.onSessionEnd(messages)
      } catch (err) {
        // 非阻塞
      }
    }
  }

  /** 通知外部 provider 内置记忆写入 */
  onMemoryWrite(action: string, target: string, content: string): void {
    for (const provider of this.providers) {
      if (provider.name === 'builtin') continue
      try {
        provider.onMemoryWrite(action, target, content)
      } catch (err) {
        // 非阻塞
      }
    }
  }

  /** 关闭所有 provider（逆序） */
  shutdownAll(): void {
    for (const provider of [...this.providers].reverse()) {
      try {
        provider.shutdown()
      } catch (err) {
        console.warn(`[MemoryManager] ${provider.name}.shutdown 失败:`, err)
      }
    }
  }
}
