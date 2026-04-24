/**
 * MemoryProvider 抽象接口。
 * 移植自 Hermes MemoryProvider ABC，适配 TypeScript/Bun。
 *
 * 生命周期：
 *   initialize()           — 创建资源、连接数据库
 *   systemPromptBlock()    — 返回静态 system prompt 文本
 *   prefetch(query)        — 每轮 API 调用前的背景检索
 *   syncTurn(user, asst)   — 每轮完成后的同步写入
 *   getToolSchemas()       — 暴露给模型的工具 schema
 *   handleToolCall()       — 分发工具调用
 *   shutdown()             — 清理关闭
 */

import type { ToolSchema, ProviderContext } from './types'

export abstract class MemoryProvider {
  /** 短标识符，如 'builtin'、'holographic' */
  abstract get name(): string

  /** 是否可用（检查配置和依赖，不发起网络请求） */
  abstract isAvailable(): boolean

  /** 初始化，创建资源 */
  abstract initialize(ctx: ProviderContext): void

  /** 返回 system prompt 中的静态文本块 */
  systemPromptBlock(): string {
    return ''
  }

  /** 每轮 API 调用前的检索，返回格式化文本 */
  prefetch(query: string): string {
    return ''
  }

  /** 每轮完成后的同步（应非阻塞） */
  syncTurn(_userContent: string, _assistantContent: string): void {
    // 默认无操作
  }

  /** 暴露给模型的工具 schema 列表 */
  getToolSchemas(): ToolSchema[] {
    return []
  }

  /** 处理工具调用，返回 JSON 字符串 */
  handleToolCall(toolName: string, _args: Record<string, unknown>): string {
    throw new Error(`Provider ${this.name} does not handle tool ${toolName}`)
  }

  /** 会话结束时的通知 */
  onSessionEnd(_messages: Array<{ role: string; content: string }>): void {
    // 默认无操作
  }

  /** 内置记忆写入时的镜像通知 */
  onMemoryWrite(_action: string, _target: string, _content: string): void {
    // 默认无操作
  }

  /** 清理关闭 */
  shutdown(): void {
    // 默认无操作
  }
}
