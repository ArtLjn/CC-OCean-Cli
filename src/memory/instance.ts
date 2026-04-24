/**
 * MemoryManager 全局单例。
 * 负责初始化和生命周期管理。
 */

import { MemoryManager } from './MemoryManager'
import { BuiltinMemoryProvider } from './providers/BuiltinMemoryProvider'
import { HolographicProvider } from './providers/HolographicProvider'
import type { ProviderContext } from './types'

let _instance: MemoryManager | null = null

/** 获取全局 MemoryManager 实例（懒初始化） */
export function getMemoryManager(ctx?: ProviderContext): MemoryManager | null {
  if (_instance) return _instance

  if (!ctx) return null

  try {
    _instance = new MemoryManager()
    _instance.addProvider(new BuiltinMemoryProvider())

    const holographic = new HolographicProvider()
    if (holographic.isAvailable()) {
      _instance.addProvider(holographic)
    }

    _instance.initializeAll(ctx)
    return _instance
  } catch (err) {
    console.warn('[Memory] 初始化失败:', err)
    _instance = null
    return null
  }
}

/** 关闭全局 MemoryManager */
export function shutdownMemoryManager(): void {
  if (_instance) {
    _instance.shutdownAll()
    _instance = null
  }
}
