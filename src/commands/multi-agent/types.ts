/** 单个 Agent 配置 */
export interface AgentConfig {
  /** 唯一标识，如 "architect" */
  id: string
  /** 显示名称，如 "架构师" */
  name: string
  /** 模型字符串：官方模型名 或 "providerId:modelId" */
  model: string
  /** 角色标签 */
  role: string
  /** System Prompt */
  systemPrompt: string
  /** 是否启用 */
  enabled: boolean
  /** 最大输出 token 数 */
  maxTokens: number
}

/** 合并策略 */
export type MergeStrategy = 'parallel' | 'sequential'

/** 输出格式 */
export type OutputFormat = 'full' | 'summary'

/** agents.json 完整结构 */
export interface AgentsConfig {
  version: 1
  agents: AgentConfig[]
  mergeStrategy: MergeStrategy
  outputFormat: OutputFormat
}

/** Agent 执行结果 */
export interface AgentResult {
  agent: AgentConfig
  output: string
  success: boolean
  error?: string
  durationMs: number
}
