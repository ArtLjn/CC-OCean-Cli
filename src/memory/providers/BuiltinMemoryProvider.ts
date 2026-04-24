/**
 * 内置记忆 Provider。
 * 包装现有 memdir 体系，不重复实现功能。
 * memdir 的 prompt 构建和文件注入保持原有路径不变。
 */

import { MemoryProvider } from '../MemoryProvider'
import type { ProviderContext } from '../types'

export class BuiltinMemoryProvider extends MemoryProvider {
  get name(): string {
    return 'builtin'
  }

  isAvailable(): boolean {
    // memdir 有自己的可用性检查逻辑（isAutoMemoryEnabled）
    // 这里返回 true，让 memdir 自行管理
    return true
  }

  initialize(_ctx: ProviderContext): void {
    // memdir 有自己的初始化逻辑（ensureMemoryDirExists 等）
    // 不在这里重复
  }

  // memdir 的 system prompt 通过现有的 systemPromptSection('memory') 注入
  // prefetch 通过 attachments.ts 的 findRelevantMemories 处理
  // 不在这里重复实现，避免双重注入
}
